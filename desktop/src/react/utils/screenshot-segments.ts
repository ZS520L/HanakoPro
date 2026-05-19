import type { ChatMessage, ContentBlock, UserAttachment } from '../stores/chat-types';
import { isImageOrSvgExt } from './file-kind';

export const SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT = 10_000;
export const SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT_STORAGE_KEY = 'hana-screenshot-segment-char-limit';
const IMAGE_BLOCK_VISIBLE_CHAR_WEIGHT = 6_000;

export function readScreenshotSegmentVisibleCharLimit(storage: Storage = localStorage): number {
  const raw = storage.getItem(SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT_STORAGE_KEY);
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT;
  return Math.max(1_000, Math.min(100_000, parsed));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function isImageAttachment(attachment: UserAttachment): boolean {
  if (attachment.mimeType?.startsWith('image/')) return true;
  const ext = (attachment.name || attachment.path || '').toLowerCase().replace(/^.*\./, '');
  return Boolean(ext && isImageOrSvgExt(ext));
}

function blockVisibleWeight(block: ContentBlock): number {
  if (block.type === 'text') return stripHtml(block.html).length;
  if (block.type === 'file' && isImageOrSvgExt(block.ext)) return IMAGE_BLOCK_VISIBLE_CHAR_WEIGHT;
  if (block.type === 'screenshot') return IMAGE_BLOCK_VISIBLE_CHAR_WEIGHT;
  return 0;
}

export function estimateScreenshotVisibleChars(message: ChatMessage): number {
  if (message.role === 'user') {
    const imageWeight = (message.attachments || [])
      .filter(isImageAttachment)
      .length * IMAGE_BLOCK_VISIBLE_CHAR_WEIGHT;
    return (message.text || '').length + imageWeight;
  }

  return (message.blocks || []).reduce((sum, block) => sum + blockVisibleWeight(block), 0);
}

function groupMessagesIntoRounds(messages: ChatMessage[]): ChatMessage[][] {
  const rounds: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user' && current.length > 0) {
      rounds.push(current);
      current = [];
    }

    current.push(message);
  }

  if (current.length > 0) rounds.push(current);
  return rounds;
}

export function splitScreenshotMessages(
  messages: ChatMessage[],
  visibleCharLimit = SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT,
): ChatMessage[][] {
  if (messages.length === 0) return [];

  const limit = Math.max(1, visibleCharLimit);
  const rounds = groupMessagesIntoRounds(messages);
  const chunks: ChatMessage[][] = [];
  let currentChunk: ChatMessage[] = [];
  let currentWeight = 0;

  for (const round of rounds) {
    const roundWeight = round.reduce((sum, message) => sum + estimateScreenshotVisibleChars(message), 0);
    if (currentChunk.length > 0 && currentWeight + roundWeight > limit) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentWeight = 0;
    }

    currentChunk.push(...round);
    currentWeight += roundWeight;
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}
