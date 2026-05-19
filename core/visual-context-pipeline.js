import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  VISION_CONTEXT_END,
  VISION_CONTEXT_START,
} from "./vision-bridge.js";

function isExplicitTextOnlyModel(model) {
  return Array.isArray(model?.input) && !model.input.includes("image");
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => block?.type === "text" ? block.text || "" : "")
    .join("\n");
}

function userRequestFromMessages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = contentText(msg.content);
    if (text) return text;
  }
  return "";
}

function sha256(parts) {
  const h = crypto.createHash("sha256");
  for (const part of parts) {
    h.update(String(part ?? ""));
    h.update("\0");
  }
  return h.digest("hex");
}

function base64ContentHash(data) {
  try {
    return crypto.createHash("sha256").update(Buffer.from(String(data || ""), "base64")).digest("hex");
  } catch {
    return sha256([data || ""]);
  }
}

export function visualResourceKeyForImage(image) {
  const contentHash = base64ContentHash(image?.data || "");
  return `visual-resource:image:${sha256([
    image?.mimeType || image?.mime || "image/png",
    contentHash,
  ])}`;
}

export function visualResourceKeyForSessionFile(file, contentHash) {
  return `visual-resource:session-file:${sha256([
    file?.id || file?.fileId || "",
    file?.sessionPath || "",
    file?.realPath || file?.filePath || "",
    file?.mime || "",
    file?.size ?? "",
    contentHash || "",
  ])}`;
}

function imageBlockResource(block, index) {
  if (!block || block.type !== "image" || !block.data) return null;
  const mimeType = block.mimeType || block.mime || "image/png";
  const contentHash = base64ContentHash(block.data);
  return {
    key: visualResourceKeyForImage({ ...block, mimeType }),
    label: `image ${index + 1}`,
    contentHash,
    image: { type: "image", mimeType, data: block.data },
  };
}

function sessionFileRefsFromDetails(details) {
  if (!details || typeof details !== "object") return [];
  const refs = [];
  const items = Array.isArray(details.media?.items) ? details.media.items : [];
  for (const item of items) {
    if (item?.type === "session_file") refs.push(item);
  }
  const files = Array.isArray(details.files) ? details.files : [];
  for (const file of files) refs.push(file);
  if (details.screenshotFile) refs.push(details.screenshotFile);
  if (details.fileId || details.id || details.filePath) refs.push(details);
  return refs;
}

async function resolveSessionFileRef(ref, { sessionPath, resolveSessionFile }) {
  let file = null;
  if (typeof resolveSessionFile === "function") {
    file = await resolveSessionFile({
      fileId: ref?.fileId || ref?.id || null,
      filePath: ref?.filePath || null,
      sessionPath: ref?.sessionPath || sessionPath || null,
    });
  }
  if (!file && ref?.filePath) file = ref;
  return file || null;
}

function isImageSessionFile(file) {
  if (!file || typeof file !== "object") return false;
  if (file.status && file.status !== "available") return false;
  if (file.kind === "image") return true;
  return String(file.mime || "").toLowerCase().startsWith("image/");
}

async function sessionFileResource(file) {
  if (!isImageSessionFile(file)) return null;
  const filePath = file.realPath || file.filePath;
  if (!filePath || !path.isAbsolute(filePath)) return null;
  const bytes = await fs.readFile(filePath);
  const mimeType = file.mime || "image/png";
  const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    key: visualResourceKeyForSessionFile(file, contentHash),
    label: file.label || file.displayName || file.filename || path.basename(filePath),
    contentHash,
    image: { type: "image", mimeType, data: bytes.toString("base64") },
  };
}

async function collectMessageResources(msg, options) {
  if (!msg || typeof msg !== "object") return [];
  if (contentText(msg.content).includes(VISION_CONTEXT_START)) return [];
  const resources = [];
  if (Array.isArray(msg.content)) {
    for (let i = 0; i < msg.content.length; i++) {
      const resource = imageBlockResource(msg.content[i], i);
      if (resource) resources.push(resource);
    }
  }
  for (const ref of sessionFileRefsFromDetails(msg.details)) {
    const file = await resolveSessionFileRef(ref, options);
    const resource = await sessionFileResource(file).catch((err) => {
      options.warn?.(`visual session file skipped: ${err?.message || err}`);
      return null;
    });
    if (resource) resources.push(resource);
  }
  return resources;
}

function dedupeResources(resources) {
  const seen = new Set();
  const out = [];
  for (const resource of resources) {
    const identity = resource?.contentHash || resource?.key;
    if (!resource?.key || seen.has(identity)) continue;
    seen.add(identity);
    out.push(resource);
  }
  return out;
}

function formatVisionContext(notes) {
  const lines = notes.map((entry, index) => {
    const label = entry.label ? ` (${entry.label})` : "";
    return `image_${index + 1}${label}: ${entry.note}`;
  });
  return `${VISION_CONTEXT_START}\n${lines.join("\n\n")}\n${VISION_CONTEXT_END}\n\n`;
}

function injectMessageNotes(msg, notes) {
  if (!notes.length) return msg;
  const block = formatVisionContext(notes);
  if (typeof msg.content === "string") {
    if (msg.content.includes(VISION_CONTEXT_START)) return msg;
    return { ...msg, content: `${block}${msg.content}` };
  }
  if (!Array.isArray(msg.content)) {
    return { ...msg, content: [{ type: "text", text: block }] };
  }
  if (contentText(msg.content).includes(VISION_CONTEXT_START)) return msg;
  return {
    ...msg,
    content: [{ type: "text", text: block }, ...msg.content],
  };
}

export async function adaptVisualContextMessages({
  messages,
  sessionPath,
  targetModel,
  visionBridge,
  isVisionAuxiliaryEnabled,
  resolveSessionFile,
  warn,
} = {}) {
  if (!Array.isArray(messages)) return { messages, injected: 0 };
  if (!isExplicitTextOnlyModel(targetModel)) return { messages, injected: 0 };
  if (isVisionAuxiliaryEnabled?.() !== true) return { messages, injected: 0 };
  if (!visionBridge?.prepareResources) return { messages, injected: 0 };

  const byMessage = [];
  const allResources = [];
  for (let i = 0; i < messages.length; i++) {
    const resources = await collectMessageResources(messages[i], {
      sessionPath,
      resolveSessionFile,
      warn,
    });
    const unique = dedupeResources(resources);
    byMessage[i] = unique;
    allResources.push(...unique);
  }

  const resources = dedupeResources(allResources);
  if (!resources.length) return { messages, injected: 0 };

  const prepared = await visionBridge.prepareResources({
    sessionPath,
    targetModel,
    userRequest: userRequestFromMessages(messages),
    resources,
  });
  const notesByKey = new Map((prepared.notes || []).map((note) => [note.key, note]));
  let injected = 0;
  const next = messages.map((msg, index) => {
    const notes = (byMessage[index] || [])
      .map((resource) => notesByKey.get(resource.key))
      .filter(Boolean);
    if (!notes.length) return msg;
    injected += notes.length;
    return injectMessageNotes(msg, notes);
  });

  return injected ? { messages: next, injected } : { messages, injected: 0 };
}
