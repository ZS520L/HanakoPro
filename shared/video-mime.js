export const ALLOWED_CHAT_VIDEO_MIME_TYPES = Object.freeze([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const MAX_CHAT_VIDEO_BASE64_CHARS = 20 * 1024 * 1024;

const MIME_TO_EXT = Object.freeze({
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
});

export function normalizeVideoMimeType(mimeType) {
  return typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
}

export function isAllowedChatVideoMime(mimeType) {
  return ALLOWED_CHAT_VIDEO_MIME_TYPES.includes(normalizeVideoMimeType(mimeType));
}

export function extensionFromChatVideoMime(mimeType) {
  return MIME_TO_EXT[normalizeVideoMimeType(mimeType)] || "";
}

export function isChatVideoBase64WithinLimit(base64Data) {
  return typeof base64Data === "string" && base64Data.length <= MAX_CHAT_VIDEO_BASE64_CHARS;
}
