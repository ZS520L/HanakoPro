/**
 * streamBufferManager 行为测试
 *
 * 聚焦 "MOOD 后中断" bug 的三条防线：
 *   1) snapshot 能反映 in-flight 内容（供 loadMessages 合并）
 *   2) invalidate 桥接能清掉 buf（数据归属方主动清）
 *   3) ensureMessage 自愈：session 被 initSession 覆盖后，后续 live 事件仍能
 *      绑定回同一条 assistant message，而不是靠"最后一条消息"猜目标
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { streamBufferManager } from '../../hooks/use-stream-buffer';
import {
  snapshotStreamBuffer,
  invalidateStreamBuffer,
} from '../../stores/stream-invalidator';
import { useStore } from '../../stores';
import type { ChatListItem, ChatMessage } from '../../stores/chat-types';

const PATH = '/test/session.jsonl';

function userItem(id: string, text: string): ChatListItem {
  return { type: 'message', data: { id, role: 'user', text } };
}

function getItems(): ChatListItem[] {
  return useStore.getState().chatSessions[PATH]?.items ?? [];
}

function lastRole(): string | undefined {
  const items = getItems();
  const last = items[items.length - 1];
  return last?.type === 'message' ? last.data.role : undefined;
}

function getAssistantMessage(): ChatMessage | null {
  const item = getItems().find((entry) => entry.type === 'message' && entry.data.role === 'assistant');
  return item?.type === 'message' ? item.data : null;
}

function getThinkingBlock() {
  return getAssistantMessage()?.blocks?.find((block) => block.type === 'thinking') ?? null;
}

describe('streamBufferManager.snapshot', () => {
  beforeEach(() => {
    streamBufferManager.clearAll();
    useStore.getState().clearSession(PATH);
    useStore.getState().initSession(PATH, [userItem('u1', 'hi')], false);
  });

  it('空 buffer 返回 null', () => {
    expect(snapshotStreamBuffer(PATH)).toBeNull();
  });

  it('累积 mood + text 后，snapshot 反映当前内容', () => {
    useStore.setState({
      sessions: [{
        path: PATH,
        agentId: 'owner',
        title: null,
        firstMessage: '',
        modified: '',
        messageCount: 0,
      }],
      agents: [{ id: 'owner', yuan: 'butter' }],
      currentAgentId: 'focus',
      agentYuan: 'hanako',
    } as never);

    streamBufferManager.handle({ type: 'mood_start', sessionPath: PATH });
    streamBufferManager.handle({ type: 'mood_text', sessionPath: PATH, delta: 'Vibe: 好\n' });
    streamBufferManager.handle({ type: 'mood_text', sessionPath: PATH, delta: 'Will: 继续' });
    streamBufferManager.handle({ type: 'mood_end', sessionPath: PATH });
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: '正文开始' });

    const snap = snapshotStreamBuffer(PATH);
    const streamed = getItems()[1];
    expect(streamed?.type).toBe('message');
    expect(snap).not.toBeNull();
    expect(snap!.hasContent).toBe(true);
    expect(snap!.messageId).toBe(streamed && streamed.type === 'message' ? streamed.data.id : null);
    expect(snap!.mood).toBe('Vibe: 好\nWill: 继续');
    expect(snap!.moodYuan).toBe('butter');
    expect(snap!.text).toBe('正文开始');
    expect(snap!.inMood).toBe(false);
  });

  it('invalidate 之后 snapshot 变 null（归属方清干净）', () => {
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: 'abc' });
    expect(snapshotStreamBuffer(PATH)?.hasContent).toBe(true);

    invalidateStreamBuffer(PATH);
    expect(snapshotStreamBuffer(PATH)).toBeNull();
  });
});

describe('streamBufferManager.thinking 流式刷新', () => {
  beforeEach(() => {
    streamBufferManager.clearAll();
    useStore.getState().clearSession(PATH);
    useStore.getState().initSession(PATH, [userItem('u1', 'hi')], false);
  });

  it('thinking_delta 按既有时间节流刷新，未 thinking_end 也能显示内容', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'));

      streamBufferManager.handle({ type: 'thinking_start', sessionPath: PATH });
      streamBufferManager.handle({ type: 'thinking_delta', sessionPath: PATH, delta: '第一段思考' });

      const beforeFlush = getThinkingBlock();
      expect(beforeFlush).toEqual({ type: 'thinking', content: '', sealed: false });

      vi.advanceTimersByTime(199);
      expect(getThinkingBlock()).toEqual({ type: 'thinking', content: '', sealed: false });

      vi.advanceTimersByTime(1);
      expect(getThinkingBlock()).toEqual({ type: 'thinking', content: '第一段思考', sealed: false });
    } finally {
      streamBufferManager.clearAll();
      vi.useRealTimers();
    }
  });

  it('多段 thinking 按事件顺序保留，不覆盖旧 thinking', () => {
    streamBufferManager.handle({ type: 'thinking_start', sessionPath: PATH });
    streamBufferManager.handle({ type: 'thinking_delta', sessionPath: PATH, delta: '第一段思考' });
    streamBufferManager.handle({ type: 'thinking_end', sessionPath: PATH });
    streamBufferManager.handle({ type: 'tool_start', sessionPath: PATH, name: 'web_search', args: { query: '岸边客 歌词' } });
    streamBufferManager.handle({ type: 'tool_end', sessionPath: PATH, name: 'web_search', success: true, details: {} });
    streamBufferManager.handle({ type: 'thinking_start', sessionPath: PATH });
    streamBufferManager.handle({ type: 'thinking_delta', sessionPath: PATH, delta: '第二段思考' });
    streamBufferManager.handle({ type: 'thinking_end', sessionPath: PATH });

    const blocks = getAssistantMessage()?.blocks ?? [];
    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'tool_group', 'thinking']);
    expect(blocks.filter((block) => block.type === 'thinking').map((block) => block.content)).toEqual([
      '第一段思考',
      '第二段思考',
    ]);
  });

  it('thinking_end 后正文刷新不重复 thinking block', () => {
    streamBufferManager.handle({ type: 'thinking_start', sessionPath: PATH });
    streamBufferManager.handle({ type: 'thinking_delta', sessionPath: PATH, delta: '已完成思考' });
    streamBufferManager.handle({ type: 'thinking_end', sessionPath: PATH });
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: '正文' });
    streamBufferManager.handle({ type: 'turn_end', sessionPath: PATH });

    const blocks = getAssistantMessage()?.blocks ?? [];
    expect(blocks.map((block) => block.type)).toEqual(['thinking', 'text']);
    expect(blocks.filter((block) => block.type === 'thinking')).toHaveLength(1);
  });
});

describe('streamBufferManager.ensureMessage 自愈', () => {
  beforeEach(() => {
    streamBufferManager.clearAll();
    useStore.getState().clearSession(PATH);
    useStore.getState().initSession(PATH, [userItem('u1', 'hi')], false);
  });

  it('首次 text_delta 会 append 一条新 assistant', () => {
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: '你好' });
    expect(getItems().length).toBe(2);
    expect(lastRole()).toBe('assistant');
  });

  it('text block keeps source markdown for display-only streaming effects', () => {
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: '**你好**' });

    const textBlock = getAssistantMessage()?.blocks?.find((block) => block.type === 'text');
    expect(textBlock).toMatchObject({
      type: 'text',
      source: '**你好**',
    });
    expect(textBlock && 'html' in textBlock ? textBlock.html : '').toContain('<strong>');
  });

  it('initSession 覆盖同 path 后，后续 tool 事件仍绑定回原 assistant 消息', () => {
    streamBufferManager.handle({ type: 'text_delta', sessionPath: PATH, delta: 'first' });
    expect(getItems().length).toBe(2);
    expect(lastRole()).toBe('assistant');
    const firstAssistant = getItems()[1];
    const assistantId = firstAssistant?.type === 'message' ? firstAssistant.data.id : null;
    expect(assistantId).toBeTruthy();

    // 模拟 loadMessages 覆盖同 path：store 里暂时只剩 user。
    useStore.getState().initSession(PATH, [userItem('u1', 'hi')], false);
    expect(getItems().length).toBe(1);
    expect(lastRole()).toBe('user');

    // 后续不一定还有 text_delta；tool_start 也必须能把同一条 assistant 重新接回来。
    streamBufferManager.handle({ type: 'tool_start', sessionPath: PATH, name: 'web.search', args: { q: 'mi mo' } });
    expect(getItems().length).toBe(2);
    expect(lastRole()).toBe('assistant');
    const last = getItems()[1];
    expect(last.type).toBe('message');
    if (last.type !== 'message') throw new Error('expected assistant message');
    expect(last.data.id).toBe(assistantId);
    expect(last.data.blocks?.some((block: { type: string }) => block.type === 'tool_group')).toBe(true);
  });

  it('tool_progress updates the active tool and tool_end clears progress', () => {
    streamBufferManager.handle({ type: 'tool_start', sessionPath: PATH, name: 'write', args: { path: 'large.md' } });
    streamBufferManager.handle({
      type: 'tool_progress',
      sessionPath: PATH,
      name: 'write',
      stage: 'writing',
      bytesWritten: 50,
      totalBytes: 100,
      progress: 0.5,
      fileName: 'large.md',
      operation: 'created',
      previewChunk: '# Demo\n',
    });

    let last = getAssistantMessage();
    let group = last?.blocks?.find((block: { type: string }) => block.type === 'tool_group') as any;
    expect(group?.tools?.[0]?.progress).toMatchObject({
      stage: 'writing',
      bytesWritten: 50,
      totalBytes: 100,
      progress: 0.5,
      fileName: 'large.md',
      operation: 'created',
      previewText: '# Demo\n',
    });

    streamBufferManager.handle({
      type: 'tool_end',
      sessionPath: PATH,
      name: 'write',
      success: true,
      details: { fileName: 'large.md' },
    });

    last = getAssistantMessage();
    group = last?.blocks?.find((block: { type: string }) => block.type === 'tool_group') as any;
    expect(group?.tools?.[0]?.done).toBe(true);
    expect(group?.tools?.[0]?.progress).toBeUndefined();
  });

  it('file_write_prepare creates an early live file card and tool_start reuses it', () => {
    streamBufferManager.handle({
      type: 'file_write_prepare',
      sessionPath: PATH,
      name: 'write',
      prepareKey: 'tool-1',
      rawPath: 'early.md',
      fileName: 'early.md',
      previewText: '# Early\n',
    });

    let last = getAssistantMessage();
    let group = last?.blocks?.find((block: { type: string }) => block.type === 'tool_group') as any;
    expect(group?.tools).toHaveLength(1);
    expect(group?.tools?.[0]).toMatchObject({
      name: 'write',
      pendingToolStart: true,
      prepareKey: 'tool-1',
      progress: {
        stage: 'preparing',
        rawPath: 'early.md',
        fileName: 'early.md',
        previewText: '# Early\n',
      },
    });

    streamBufferManager.handle({ type: 'tool_start', sessionPath: PATH, name: 'write', args: { path: 'early.md' } });

    last = getAssistantMessage();
    group = last?.blocks?.find((block: { type: string }) => block.type === 'tool_group') as any;
    expect(group?.tools).toHaveLength(1);
    expect(group?.tools?.[0]?.pendingToolStart).toBe(false);
    expect(group?.tools?.[0]?.progress?.previewText).toBe('# Early\n');
  });

  it('keeps start preview when a later reset event has no preview chunk', () => {
    streamBufferManager.handle({ type: 'tool_start', sessionPath: PATH, name: 'write', args: { path: 'start.md' } });
    streamBufferManager.handle({
      type: 'tool_progress',
      sessionPath: PATH,
      name: 'write',
      stage: 'writing',
      fileName: 'start.md',
      previewReset: true,
      previewChunk: '# Start\n',
    });
    streamBufferManager.handle({
      type: 'tool_progress',
      sessionPath: PATH,
      name: 'write',
      stage: 'writing',
      fileName: 'start.md',
      previewReset: true,
    });

    const last = getAssistantMessage();
    const group = last?.blocks?.find((block: { type: string }) => block.type === 'tool_group') as any;
    expect(group?.tools?.[0]?.progress?.previewText).toBe('# Start\n');
  });
});
