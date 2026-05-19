import { normalizeMediaItems } from "../bridge/media-item-normalizer.js";

export function collectMediaItems(media) {
  if (!media || typeof media !== "object") return [];
  if (Array.isArray(media.items) && media.items.length) {
    return normalizeMediaItems(media.items);
  }
  // COMPAT(mediaUrls, remove no earlier than v0.133):
  // New producers should return structured details.media.items. mediaUrls remains
  // only for old tool results and text-extracted Bridge media.
  if (Array.isArray(media.mediaUrls)) {
    return normalizeMediaItems(media.mediaUrls);
  }
  return [];
}
