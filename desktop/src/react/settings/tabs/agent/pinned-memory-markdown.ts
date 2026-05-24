const EXPORT_TITLE = "# HanakoPro 置顶记忆";

function normalizePin(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeListItem(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line, index) => index === 0 ? line : `  ${line}`)
    .join('\n');
}

function unescapeListItem(value: string): string {
  return value
    .replace(/\n {2}/g, '\n')
    .replace(/\n\t/g, '\n')
    .trim();
}

export function buildPinnedMemoryMarkdown(pins: string[]): string {
  const lines = pins
    .map(normalizePin)
    .filter(Boolean)
    .map(pin => `- ${escapeListItem(pin)}`);

  return `${EXPORT_TITLE}\n\n${lines.join('\n')}\n`;
}

export function parsePinnedMemoryMarkdown(markdown: string): string[] {
  if (typeof markdown !== 'string') return [];

  const pins: string[] = [];
  let current: string | null = null;
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const flush = () => {
    const normalized = current === null ? '' : unescapeListItem(current);
    if (normalized) pins.push(normalized);
    current = null;
  };

  for (const rawLine of lines) {
    const itemMatch = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    if (itemMatch) {
      flush();
      current = itemMatch[1];
      continue;
    }

    if (current !== null && /^(\s{2,}|\t)\S/.test(rawLine)) {
      current += `\n${rawLine.replace(/^(\s{2,}|\t)/, '')}`;
      continue;
    }

    if (!rawLine.trim()) {
      continue;
    }
  }

  flush();
  return pins;
}

export function mergePinnedMemories(existingPins: string[], importedPins: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const pin of [...existingPins, ...importedPins]) {
    const normalized = normalizePin(pin);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}
