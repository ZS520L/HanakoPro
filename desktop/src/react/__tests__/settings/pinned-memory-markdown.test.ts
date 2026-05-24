import { describe, expect, it } from 'vitest';
import {
  buildPinnedMemoryMarkdown,
  mergePinnedMemories,
  parsePinnedMemoryMarkdown,
} from '../../settings/tabs/agent/pinned-memory-markdown';

describe('pinned memory markdown import/export', () => {
  it('exports pins as a markdown list compatible with pinned.md', () => {
    expect(buildPinnedMemoryMarkdown(['目标是明年拿到基金', '用户已配置 Exa MCP 工具'])).toBe([
      '# HanakoPro 置顶记忆',
      '',
      '- 目标是明年拿到基金',
      '- 用户已配置 Exa MCP 工具',
      '',
    ].join('\n'));
  });

  it('parses exported markdown and plain pinned.md bullet lists', () => {
    const markdown = [
      '# HanakoPro 置顶记忆',
      '',
      '- 第一条',
      '- 第二条',
      '* 第三条',
      '+ 第四条',
    ].join('\n');

    expect(parsePinnedMemoryMarkdown(markdown)).toEqual(['第一条', '第二条', '第三条', '第四条']);
  });

  it('preserves multiline list items for future-proof markdown files', () => {
    const markdown = buildPinnedMemoryMarkdown(['第一行\n第二行']);
    expect(parsePinnedMemoryMarkdown(markdown)).toEqual(['第一行\n第二行']);
  });

  it('merges imported pins without duplicates or empty entries', () => {
    expect(mergePinnedMemories(['A', 'B'], ['B', ' C ', '', 'A'])).toEqual(['A', 'B', 'C']);
  });
});
