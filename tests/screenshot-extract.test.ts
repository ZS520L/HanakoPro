import { describe, it, expect } from 'vitest';
import { buildThemeName, extractScreenshotPayload } from '../desktop/src/react/utils/screenshot-extract';

describe('buildThemeName', () => {
  it('light + mobile → solarized-light', () => {
    expect(buildThemeName('light', 'mobile')).toBe('solarized-light');
  });
  it('light + desktop → solarized-light-desktop', () => {
    expect(buildThemeName('light', 'desktop')).toBe('solarized-light-desktop');
  });
  it('dark + mobile → solarized-dark', () => {
    expect(buildThemeName('dark', 'mobile')).toBe('solarized-dark');
  });
  it('dark + desktop → solarized-dark-desktop', () => {
    expect(buildThemeName('dark', 'desktop')).toBe('solarized-dark-desktop');
  });
  it('sakura + mobile → sakura-light', () => {
    expect(buildThemeName('sakura', 'mobile')).toBe('sakura-light');
  });
  it('sakura + desktop → sakura-light-desktop', () => {
    expect(buildThemeName('sakura', 'desktop')).toBe('sakura-light-desktop');
  });
});

describe('extractScreenshotPayload', () => {
  it('single role (assistant text) → article mode, blocks are html type', () => {
    const messages = [
      { id: '1', role: 'assistant' as const, blocks: [{ type: 'text' as const, html: '<h1>Hello</h1>' }] },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.mode).toBe('article');
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].blocks[0]).toEqual({ type: 'html', content: '<h1>Hello</h1>' });
  });

  it('single role (user text) → article mode, blocks are markdown type', () => {
    const messages = [
      { id: '1', role: 'user' as const, text: '# Hello' },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.mode).toBe('article');
    expect(result.messages![0].blocks[0]).toEqual({ type: 'markdown', content: '# Hello' });
  });

  it('mixed roles → conversation mode', () => {
    const messages = [
      { id: '1', role: 'user' as const, text: '你好' },
      { id: '2', role: 'assistant' as const, blocks: [{ type: 'text' as const, html: '<p>你好！</p>' }] },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-dark');
    expect(result.mode).toBe('conversation');
    expect(result.messages).toHaveLength(2);
    expect(result.messages![0].blocks[0].type).toBe('markdown');
    expect(result.messages![1].blocks[0].type).toBe('html');
  });

  it('filters out thinking/mood/tool blocks', () => {
    const messages = [
      {
        id: '1', role: 'assistant' as const, blocks: [
          { type: 'thinking' as const, content: '...', sealed: true },
          { type: 'mood' as const, yuan: 'hanako', text: 'happy' },
          { type: 'tool_group' as const, tools: [] as any[], collapsed: true },
          { type: 'text' as const, html: '<p>visible</p>' },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toHaveLength(1);
    expect(result.messages![0].blocks[0]).toEqual({ type: 'html', content: '<p>visible</p>' });
  });

  it('keeps image file_output', () => {
    const messages = [
      {
        id: '1', role: 'assistant' as const, blocks: [
          { type: 'text' as const, html: '<p>text</p>' },
          { type: 'file' as const, filePath: '/tmp/img.png', label: 'img', ext: 'png' },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toHaveLength(2);
    expect(result.messages![0].blocks[1]).toEqual({ type: 'image', content: '/tmp/img.png' });
  });

  it('keeps assistant screenshot image blocks as data URLs', () => {
    const messages = [
      {
        id: '1', role: 'assistant' as const, blocks: [
          { type: 'screenshot' as const, base64: 'ABC123', mimeType: 'image/png' },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toEqual([
      { type: 'image', content: 'data:image/png;base64,ABC123' },
    ]);
  });

  it('keeps user image attachments even when they are auxiliary vision images', () => {
    const messages = [
      {
        id: '1',
        role: 'user' as const,
        text: '看这张图',
        attachments: [
          { path: '/tmp/aux.png', name: 'aux.png', isDir: false, visionAuxiliary: true },
          { path: '/tmp/native.png', name: 'native.png', isDir: false, visionAuxiliary: false },
          { path: '/tmp/readme.md', name: 'readme.md', isDir: false },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toEqual([
      { type: 'markdown', content: '看这张图' },
      { type: 'image', content: '/tmp/aux.png' },
      { type: 'image', content: '/tmp/native.png' },
    ]);
  });

  it('keeps user inline base64 image attachments as data URLs', () => {
    const messages = [
      {
        id: '1',
        role: 'user' as const,
        attachments: [
          { path: '/tmp/inline.png', name: 'inline.png', isDir: false, base64Data: 'INLINE', mimeType: 'image/webp' },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toEqual([
      { type: 'image', content: 'data:image/webp;base64,INLINE' },
    ]);
  });

  it('drops non-image file_output', () => {
    const messages = [
      {
        id: '1', role: 'assistant' as const, blocks: [
          { type: 'text' as const, html: '<p>code</p>' },
          { type: 'file' as const, filePath: '/tmp/file.py', label: 'file', ext: 'py' },
        ],
      },
    ];
    const result = extractScreenshotPayload(messages, 'solarized-light');
    expect(result.messages![0].blocks).toHaveLength(1);
    expect(result.messages![0].blocks[0].type).toBe('html');
  });

  it('empty messages → article with empty messages array', () => {
    const result = extractScreenshotPayload([], 'solarized-light');
    expect(result.mode).toBe('article');
    expect(result.messages).toHaveLength(0);
  });

  it('user message without text → empty blocks', () => {
    const messages = [{ id: '1', role: 'user' as const }];
    const result = extractScreenshotPayload(messages as any, 'solarized-light');
    expect(result.messages![0].blocks).toHaveLength(0);
  });
});
