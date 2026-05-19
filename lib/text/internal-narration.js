const INTERNAL_NARRATION_TAGS = ["mood", "pulse", "reflect"];
const INTERNAL_TAG_PATTERN = INTERNAL_NARRATION_TAGS.join("|");

export function stripInternalNarration(value) {
  return String(value || "")
    .replace(new RegExp("```(?:" + INTERNAL_TAG_PATTERN + ")[\\s\\S]*?```\\s*", "gi"), "")
    .replace(new RegExp("<(?:" + INTERNAL_TAG_PATTERN + ")\\b[^>]*>[\\s\\S]*?<\\/(?:" + INTERNAL_TAG_PATTERN + ")>\\s*", "gi"), "")
    .replace(new RegExp("<\\/?(?:" + INTERNAL_TAG_PATTERN + ")\\b[^>]*>\\s*", "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizePlainDescription(value, maxLength = 100) {
  const text = stripInternalNarration(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const cutIdx = Math.max(
    text.lastIndexOf("。", maxLength),
    text.lastIndexOf(".", maxLength),
  );
  return cutIdx > 20 ? text.slice(0, cutIdx + 1) : text.slice(0, maxLength);
}
