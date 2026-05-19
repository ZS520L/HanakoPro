import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { normalizeWin32ShellPath } from "./win32-path.js";
import { getToolSessionPath } from "../tools/tool-session.js";
import { sessionFilesCacheDir } from "../session-files/session-file-registry.js";
import { serializeSessionFile } from "../session-files/session-file-response.js";
import { VISION_CONTEXT_END, VISION_CONTEXT_START } from "../../core/vision-bridge.js";

const CONFIG_ERROR_PATTERNS = [
  "vision auxiliary model is required",
  "vision auxiliary model must support image input",
];

const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

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

function isDocxPath(filePath) {
  return path.extname(filePath || "").toLowerCase() === ".docx";
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => block?.type === "text" ? block.text || "" : "")
    .join("\n")
    .trim();
}

function normalizeContent(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function officeMediaResourceKey({ sessionPath, docxPath, index, mimeType, hash }) {
  const h = crypto.createHash("sha256");
  h.update(sessionPath || "");
  h.update("\0");
  h.update(docxPath || "");
  h.update("\0");
  h.update(String(index));
  h.update("\0");
  h.update(mimeType || "");
  h.update("\0");
  h.update(hash || "");
  return `visual-resource:read-docx:${h.digest("hex")}`;
}

function extensionForMime(mimeType) {
  return IMAGE_EXTENSIONS[String(mimeType || "").toLowerCase()] || "bin";
}

function safeFilenamePart(value, fallback) {
  const base = path.basename(String(value || "").trim() || fallback);
  const cleaned = Array.from(base, (char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1F || char === "/" || char === "\\" ? "" : char;
  }).join("").trim();
  return cleaned || fallback;
}

function mediaItemFromSessionFile(file) {
  if (!file?.fileId && !file?.id) return null;
  return {
    type: "session_file",
    fileId: file.fileId || file.id,
    sessionPath: file.sessionPath,
    filePath: file.filePath,
    filename: file.filename || path.basename(file.filePath || file.label || "docx-image"),
    label: file.label || file.displayName || file.filename,
    mime: file.mime,
    size: file.size,
    kind: file.kind || "image",
  };
}

function mergeMediaItems(details, items) {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return details;
  const existing = Array.isArray(details?.media?.items) ? details.media.items : [];
  return {
    ...details,
    media: {
      ...(details?.media || {}),
      items: [...existing, ...filtered],
    },
  };
}

function appendOfficeMediaDetails(result, {
  entries = [],
  warnings = [],
  visionAdapted,
  visionError,
} = {}) {
  let details = {
    ...(result?.details || {}),
    ...(entries.length > 0 ? {
      officeMedia: {
        kind: "docx",
        count: entries.length,
        resourceKeys: entries.map((entry) => entry.key),
      },
    } : {}),
    ...(visionAdapted !== undefined ? { visionAdapted } : {}),
    ...(visionError ? { visionError } : {}),
    ...(warnings.length > 0 ? { officeMediaWarnings: warnings } : {}),
  };
  details = mergeMediaItems(details, entries.map((entry) => entry.mediaItem));
  return {
    ...(result || {}),
    details,
  };
}

function formatVisionToolText({ docText, notes }) {
  const noteText = notes.map((entry, index) => {
    const label = entry.label ? ` (${entry.label})` : "";
    return `docx_image_${index + 1}${label}: ${entry.note}`;
  }).join("\n\n");
  const visionText = [
    "Embedded images extracted from docx",
    VISION_CONTEXT_START,
    noteText,
    VISION_CONTEXT_END,
  ].join("\n");
  return docText ? `${docText}\n\n${visionText}` : visionText;
}

function isVisionConfigError(err) {
  const message = String(err?.message || err || "");
  return CONFIG_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function warningText(result, message) {
  const text = contentText(result?.content);
  const nextText = text ? `${text}\n\n[${message}]` : `[${message}]`;
  return {
    ...(result || {}),
    content: [{ type: "text", text: nextText }],
  };
}

export async function extractDocxEmbeddedImages(docxPath) {
  const mammoth = (await import("mammoth")).default;
  const images = [];
  await mammoth.convertToHtml({ path: docxPath }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const mimeType = image.contentType || "application/octet-stream";
      if (!String(mimeType).startsWith("image/")) return { src: "" };
      const buffer = await image.readAsBuffer();
      const hash = contentHash(buffer);
      images.push({
        index: images.length + 1,
        mimeType,
        buffer,
        base64: buffer.toString("base64"),
        hash,
      });
      return { src: "" };
    }),
  });
  return images;
}

async function materializeDocxImages({
  docxPath,
  images,
  hanakoHome,
  sessionPath,
  recordFileOperation,
}) {
  const warnings = [];
  if (!images.length) return { entries: [], warnings };
  if (!hanakoHome || !sessionPath || typeof recordFileOperation !== "function") {
    warnings.push("Docx embedded images were extracted but could not be registered without session file context.");
    return {
      entries: images.map((image) => {
        const label = `${path.basename(docxPath)}#${image.index}`;
        return {
          ...image,
          key: officeMediaResourceKey({ sessionPath, docxPath, index: image.index, mimeType: image.mimeType, hash: image.hash }),
          label,
          mediaItem: null,
          sessionFile: null,
        };
      }),
      warnings,
    };
  }

  const dir = sessionFilesCacheDir(hanakoHome, sessionPath);
  await fs.mkdir(dir, { recursive: true });
  const docBase = safeFilenamePart(path.basename(docxPath, path.extname(docxPath)), "document");
  const entries = [];

  for (const image of images) {
    const ext = extensionForMime(image.mimeType);
    const label = `${docBase}-image-${image.index}.${ext}`;
    const filename = `${docBase}-image-${image.index}-${image.hash.slice(0, 12)}.${ext}`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, image.buffer);
    let sessionFile = null;
    try {
      sessionFile = serializeSessionFile(recordFileOperation({
        sessionPath,
        filePath,
        label,
        origin: "agent_read_docx_media",
        operation: "read",
        storageKind: "managed_cache",
      }));
    } catch (err) {
      warnings.push(`Session file registration failed for ${label}: ${err?.message || String(err)}`);
    }
    entries.push({
      ...image,
      key: officeMediaResourceKey({ sessionPath, docxPath, index: image.index, mimeType: image.mimeType, hash: image.hash }),
      label,
      filePath,
      sessionFile,
      mediaItem: mediaItemFromSessionFile(sessionFile),
    });
  }

  return { entries, warnings };
}

async function adaptForTextOnlyModel(result, {
  entries,
  bridge,
  model,
  sessionPath,
  docxPath,
  warnings,
}) {
  if (!bridge?.prepareResources) {
    return warningText(appendOfficeMediaDetails(result, { entries, warnings, visionAdapted: false }), "Embedded docx images were extracted, but auxiliary vision is unavailable for the current text-only model.");
  }

  const resources = entries.map((entry) => ({
    key: entry.key,
    label: entry.label,
    image: { type: "image", mimeType: entry.mimeType, data: entry.base64 },
  }));
  let prepared;
  try {
    prepared = await bridge.prepareResources({
      sessionPath,
      targetModel: model,
      userRequest: `Read embedded images from docx: ${docxPath}`,
      resources,
    });
  } catch (err) {
    const message = err?.message || String(err);
    if (isVisionConfigError(err)) {
      return warningText(appendOfficeMediaDetails(result, {
        entries,
        warnings,
        visionAdapted: false,
        visionError: message,
      }), `Embedded docx images were extracted, but auxiliary vision is not configured: ${message}`);
    }
    return warningText(appendOfficeMediaDetails(result, {
      entries,
      warnings,
      visionAdapted: false,
      visionError: message,
    }), `Auxiliary vision failed for embedded docx images: ${message}`);
  }

  const notes = Array.isArray(prepared?.notes) ? prepared.notes.filter((entry) => entry?.note) : [];
  if (!notes.length) {
    return warningText(appendOfficeMediaDetails(result, {
      entries,
      warnings,
      visionAdapted: false,
      visionError: "auxiliary vision returned no note",
    }), "Auxiliary vision returned no note for embedded docx images.");
  }

  return {
    ...appendOfficeMediaDetails(result, { entries, warnings, visionAdapted: true }),
    content: [{
      type: "text",
      text: formatVisionToolText({ docText: contentText(result?.content), notes }),
    }],
  };
}

export function wrapReadOfficeMedia(tool, cwd, {
  hanakoHome,
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
      const absolutePath = resolveToolPath(params?.path ?? params?.file_path, cwd);
      if (!absolutePath || !isDocxPath(absolutePath)) return result;

      let images = [];
      try {
        images = await extractDocxEmbeddedImages(absolutePath);
      } catch (err) {
        return warningText(appendOfficeMediaDetails(result, {
          warnings: [`Docx embedded image extraction failed: ${err?.message || String(err)}`],
          visionAdapted: false,
        }), `Docx embedded image extraction failed: ${err?.message || String(err)}`);
      }
      if (!images.length) return result;

      const sessionPath = getToolSessionPath(ctx) || getSessionPath?.() || null;
      const { entries, warnings } = await materializeDocxImages({
        docxPath: absolutePath,
        images,
        hanakoHome,
        sessionPath,
        recordFileOperation,
      });
      if (!entries.length) return result;

      const model = ctx?.model || null;
      if (isExplicitTextOnlyModel(model)) {
        if (isVisionAuxiliaryEnabled?.() !== true) {
          return warningText(appendOfficeMediaDetails(result, {
            entries,
            warnings,
            visionAdapted: false,
            visionError: "auxiliary vision disabled",
          }), "Embedded docx images were extracted, but the current model is text-only and auxiliary vision is disabled.");
        }
        return adaptForTextOnlyModel(result, {
          entries,
          bridge: getVisionBridge?.(),
          model,
          sessionPath,
          docxPath: absolutePath,
          warnings,
        });
      }

      return {
        ...appendOfficeMediaDetails(result, { entries, warnings, visionAdapted: false }),
        content: [
          ...normalizeContent(result?.content),
          ...entries.map((entry) => ({
            type: "image",
            mimeType: entry.mimeType,
            data: entry.base64,
          })),
        ],
      };
    },
  };
}
