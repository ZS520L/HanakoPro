const DEFAULT_MARKDOWN_TYPOGRAPHY = Object.freeze({
  bodyFontSize: 16,
  heading1FontSize: 24,
  heading2FontSize: 20,
  heading3FontSize: 18,
  heading4FontSize: 16,
  heading5FontSize: 15,
  heading6FontSize: 14,
  lineHeight: 1.72,
  contentPadding: 24,
});

export const DEFAULT_EDITOR_TYPOGRAPHY = Object.freeze({
  markdown: DEFAULT_MARKDOWN_TYPOGRAPHY,
});

const LIMITS = Object.freeze({
  bodyFontSize: [12, 24],
  heading1FontSize: [16, 40],
  heading2FontSize: [15, 34],
  heading3FontSize: [14, 30],
  heading4FontSize: [13, 28],
  heading5FontSize: [12, 26],
  heading6FontSize: [12, 24],
  lineHeight: [1.2, 2.2],
  contentPadding: [0, 64],
});

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return NaN;
}

function clampNumber(value, fallback, [min, max], decimals = 0) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(max, Math.max(min, parsed));
  if (decimals > 0) return Number(clamped.toFixed(decimals));
  return Math.round(clamped);
}

export function normalizeEditorTypography(value) {
  const source = isRecord(value) ? value : {};
  const markdown = isRecord(source.markdown) ? source.markdown : {};
  const defaults = DEFAULT_EDITOR_TYPOGRAPHY.markdown;

  return {
    markdown: {
      bodyFontSize: clampNumber(markdown.bodyFontSize, defaults.bodyFontSize, LIMITS.bodyFontSize),
      heading1FontSize: clampNumber(markdown.heading1FontSize, defaults.heading1FontSize, LIMITS.heading1FontSize),
      heading2FontSize: clampNumber(markdown.heading2FontSize, defaults.heading2FontSize, LIMITS.heading2FontSize),
      heading3FontSize: clampNumber(markdown.heading3FontSize, defaults.heading3FontSize, LIMITS.heading3FontSize),
      heading4FontSize: clampNumber(markdown.heading4FontSize, defaults.heading4FontSize, LIMITS.heading4FontSize),
      heading5FontSize: clampNumber(markdown.heading5FontSize, defaults.heading5FontSize, LIMITS.heading5FontSize),
      heading6FontSize: clampNumber(markdown.heading6FontSize, defaults.heading6FontSize, LIMITS.heading6FontSize),
      lineHeight: clampNumber(markdown.lineHeight, defaults.lineHeight, LIMITS.lineHeight, 2),
      contentPadding: clampNumber(markdown.contentPadding, defaults.contentPadding, LIMITS.contentPadding),
    },
  };
}

export function mergeEditorTypography(base, patch) {
  const current = normalizeEditorTypography(base);
  const source = isRecord(patch) ? patch : {};
  const markdownPatch = isRecord(source.markdown) ? source.markdown : {};

  return normalizeEditorTypography({
    ...current,
    ...source,
    markdown: {
      ...current.markdown,
      ...markdownPatch,
    },
  });
}
