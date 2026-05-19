import crypto from "crypto";
import path from "path";
import { normalizeWin32ShellPath } from "./win32-path.js";
import { getToolSessionPath } from "../tools/tool-session.js";
import { serializeSessionFile } from "../session-files/session-file-response.js";
import { VISION_CONTEXT_END, VISION_CONTEXT_START } from "../../core/vision-bridge.js";

const CONFIG_ERROR_PATTERNS = [
  "vision auxiliary model is required",
  "vision auxiliary model must support image input",
];

function isExplicitTextOnlyModel(model) {
  return Array.isArray(model?.input) && !model.input.includes("image");
}

function resolveToolPath(rawPath, cwd) {
  if (!rawPath || typeof rawPath !== "string") return null;
  if (process.platform === "win32") {
    return normalizeWin32ShellPath(rawPath, cwd, { allowRelative: true });
  }
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function readImageBlocks(result) {
  if (!Array.isArray(result?.content)) return [];
  return result.content.filter((block) =>
    block?.type === "image" && typeof block.data === "string" && block.data.length > 0,
  );
}

function firstImageMime(image) {
  return image?.mimeType || image?.mime || "image/png";
}

function base64ContentHash(data) {
  return crypto.createHash("sha256").update(Buffer.from(String(data || ""), "base64")).digest("hex");
}

function readImageResourceKey({ sessionPath, filePath, mimeType, data }) {
  const h = crypto.createHash("sha256");
  h.update(sessionPath || "");
  h.update("\0");
  h.update(filePath || "");
  h.update("\0");
  h.update(mimeType || "image/png");
  h.update("\0");
  h.update(base64ContentHash(data));
  return `visual-resource:read:${h.digest("hex")}`;
}

function mediaItemFromSessionFile(file) {
  if (!file?.fileId && !file?.id) return null;
  return {
    type: "session_file",
    fileId: file.fileId || file.id,
    sessionPath: file.sessionPath,
    filePath: file.filePath,
    filename: file.filename || path.basename(file.filePath || file.label || "read-image"),
    label: file.label || file.displayName || file.filename,
    mime: file.mime,
    size: file.size,
    kind: file.kind || "image",
  };
}

function registerReadImageSource({
  params,
  cwd,
  sessionPath,
  recordFileOperation,
}) {
  const absolutePath = resolveToolPath(params?.path ?? params?.file_path, cwd);
  if (!absolutePath || !sessionPath || typeof recordFileOperation !== "function") {
    return { absolutePath, sessionFile: null, warning: null };
  }
  try {
    const sessionFile = serializeSessionFile(recordFileOperation({
      sessionPath,
      filePath: absolutePath,
      label: path.basename(absolutePath),
      origin: "agent_read_image",
      operation: "read",
    }));
    return { absolutePath, sessionFile, warning: null };
  } catch (err) {
    return {
      absolutePath,
      sessionFile: null,
      warning: `Session file registration failed: ${err?.message || String(err)}`,
    };
  }
}

function formatVisionToolText({ mimeType, notes }) {
  const noteText = notes.map((entry, index) => {
    const label = entry.label ? ` (${entry.label})` : "";
    return `image_${index + 1}${label}: ${entry.note}`;
  }).join("\n\n");
  return [
    `Read image file [${mimeType}]`,
    VISION_CONTEXT_START,
    noteText,
    VISION_CONTEXT_END,
  ].join("\n");
}

function mergeMediaItems(details, item) {
  if (!item) return details;
  const existing = Array.isArray(details?.media?.items) ? details.media.items : [];
  return {
    ...details,
    media: {
      ...(details?.media || {}),
      items: [...existing, item],
    },
  };
}

function appendSourceDetails(result, {
  sessionFile,
  mediaItem,
  resourceKey,
  warning,
  visionAdapted,
  visionError,
} = {}) {
  let details = {
    ...(result?.details || {}),
    ...(visionAdapted !== undefined ? { visionAdapted } : {}),
    ...(resourceKey ? { visionResourceKey: resourceKey } : {}),
    ...(sessionFile ? { sessionFile } : {}),
    ...(warning ? { sessionFileWarning: warning } : {}),
    ...(visionError ? { visionError } : {}),
  };
  details = mergeMediaItems(details, mediaItem);
  return {
    ...(result || {}),
    details,
  };
}

function isVisionConfigError(err) {
  const message = String(err?.message || err || "");
  return CONFIG_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function visionFailureResult(result, errorMessage, { sessionFile, mediaItem, resourceKey, warning } = {}) {
  return {
    ...appendSourceDetails(result, {
      sessionFile,
      mediaItem,
      resourceKey,
      warning,
      visionAdapted: false,
      visionError: errorMessage,
    }),
    content: [{
      type: "text",
      text: `Read image file\nAuxiliary vision failed: ${errorMessage}`,
    }],
  };
}

export function wrapReadImageWithVisionBridge(tool, cwd, {
  getVisionBridge,
  isVisionAuxiliaryEnabled,
  getSessionPath,
  recordFileOperation,
} = {}) {
  if (!tool || tool.name !== "read" || typeof tool.execute !== "function") return tool;

  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      const images = readImageBlocks(result);
      if (!images.length) return result;

      const model = ctx?.model || null;
      if (!isExplicitTextOnlyModel(model)) return result;
      if (isVisionAuxiliaryEnabled?.() !== true) return result;

      const bridge = getVisionBridge?.();
      if (!bridge?.prepareResources) return result;

      const sessionPath = getToolSessionPath(ctx) || getSessionPath?.() || null;
      const absolutePath = resolveToolPath(params?.path ?? params?.file_path, cwd);
      const label = path.basename(absolutePath || params?.path || "image");
      const resources = images.map((image, index) => {
        const mimeType = firstImageMime(image);
        const key = readImageResourceKey({
          sessionPath,
          filePath: absolutePath,
          mimeType,
          data: image.data,
        });
        return {
          key,
          label: images.length === 1 ? label : `${label}#${index + 1}`,
          image: { type: "image", mimeType, data: image.data },
        };
      });
      const resourceKey = resources[0]?.key || null;

      let prepared;
      try {
        prepared = await bridge.prepareResources({
          sessionPath,
          targetModel: model,
          userRequest: `Read image file: ${params?.path || label}`,
          resources,
        });
      } catch (err) {
        const message = err?.message || String(err);
        if (isVisionConfigError(err)) {
          return appendSourceDetails(result, {
            resourceKey,
            visionAdapted: false,
            visionError: message,
          });
        }
        return visionFailureResult(result, message, {
          resourceKey,
        });
      }

      const notes = Array.isArray(prepared?.notes) ? prepared.notes.filter((entry) => entry?.note) : [];
      if (!notes.length) {
        return appendSourceDetails(result, {
          resourceKey,
          visionAdapted: false,
          visionError: "auxiliary vision returned no note",
        });
      }
      const { sessionFile, warning } = registerReadImageSource({
        params,
        cwd,
        sessionPath,
        recordFileOperation,
      });
      const mediaItem = mediaItemFromSessionFile(sessionFile);

      return {
        ...appendSourceDetails(result, {
          sessionFile,
          mediaItem,
          resourceKey,
          warning,
          visionAdapted: true,
        }),
        content: [{
          type: "text",
          text: formatVisionToolText({
            mimeType: firstImageMime(images[0]),
            notes,
          }),
        }],
      };
    },
  };
}
