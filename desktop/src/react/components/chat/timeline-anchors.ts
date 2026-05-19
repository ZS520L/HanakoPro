import type { ChatListItem, ChatMessage } from '../../stores/chat-types';

export interface TimelineAnchor {
  messageId: string;
  timestamp: number | null;
  label: string;
  role: ChatMessage['role'];
  markerWidthEm: number;
}

interface TimelineAnchorOptions {
  now?: Date;
  locale?: string;
  timeZone?: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseTimestamp(value: ChatMessage['timestamp']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizedPreviewSource(message: ChatMessage): string {
  const text = message.text?.replace(/\s+/g, ' ').trim();
  if (text) return text;

  const firstAttachment = message.attachments?.find(attachment => attachment.name?.trim());
  if (firstAttachment?.name) return firstAttachment.name.trim();

  return message.role === 'user' ? '用户消息' : '助手消息';
}

export function formatTimelinePromptPreview(text: string, maxChars = 10): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const chars = Array.from(normalized);
  if (chars.length <= maxChars) return normalized;
  return `${chars.slice(0, maxChars).join('')}...`;
}

export function measureTimelineMarkerWidthEm(promptLength: number): number {
  if (!Number.isFinite(promptLength) || promptLength <= 2) return 0.5;

  const normalized = Math.min(1, Math.log1p(promptLength - 2) / Math.log1p(80));
  return Number((0.5 + normalized * 0.5).toFixed(3));
}

function readDateParts(timestamp: number, timeZone?: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type === 'literal') continue;
    values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function sameDay(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function formatTimelineAnchorLabel(
  timestamp: number,
  options: TimelineAnchorOptions = {},
): string {
  const locale = options.locale || (typeof window !== 'undefined' ? window.navigator?.language : 'zh-CN') || 'zh-CN';
  const parts = readDateParts(timestamp, options.timeZone);
  const nowParts = readDateParts((options.now ?? new Date()).getTime(), options.timeZone);
  const time = `${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`;

  if (sameDay(parts, nowParts)) return time;

  const isZh = locale.toLowerCase().startsWith('zh');
  if (parts.year === nowParts.year) {
    return isZh
      ? `${parts.month}月${parts.day}日 ${time}`
      : `${parts.month}/${parts.day} ${time}`;
  }
  return isZh
    ? `${parts.year}年${parts.month}月${parts.day}日 ${time}`
    : `${parts.year}/${parts.month}/${parts.day} ${time}`;
}

export function buildTimelineAnchors(
  items: ChatListItem[],
): TimelineAnchor[] {
  const messages = items
    .filter((item): item is Extract<ChatListItem, { type: 'message' }> => item.type === 'message')
    .map(item => item.data);

  const userTurns = messages.filter(message => message.role === 'user');
  const source = userTurns.length > 0 ? userTurns : messages;

  return source.map((message) => {
    const previewSource = normalizedPreviewSource(message);
    const previewLength = Array.from(previewSource).length;
    return {
      messageId: message.id,
      timestamp: parseTimestamp(message.timestamp),
      role: message.role,
      label: formatTimelinePromptPreview(previewSource),
      markerWidthEm: measureTimelineMarkerWidthEm(previewLength),
    };
  });
}
