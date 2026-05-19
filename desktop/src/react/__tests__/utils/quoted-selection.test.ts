import { describe, expect, it } from 'vitest';
import { formatQuotedSelectionForPrompt } from '../../utils/quoted-selection';
import { parseUserAttachments } from '../../utils/message-parser';

describe('formatQuotedSelectionForPrompt', () => {
  it('includes source metadata and the selected original text in the model prompt', () => {
    const result = formatQuotedSelectionForPrompt({
      text: 'ChatGPT 2022 年底刚出来的时候，大家最先玩的是什么？角色扮演。',
      sourceTitle: '脚本-Kimi多智能体.md',
      sourceFilePath: '/Users/test/脚本-Kimi多智能体.md',
      lineStart: 17,
      lineEnd: 17,
      charCount: 34,
    });

    expect(result).toBe([
      '[引用片段] 脚本-Kimi多智能体.md（第17-17行，共34字）路径: /Users/test/脚本-Kimi多智能体.md',
      '[引用原文]',
      'ChatGPT 2022 年底刚出来的时候，大家最先玩的是什么？角色扮演。',
      '[/引用原文]',
    ].join('\n'));
  });

  it('keeps quoted original text out of the displayed user message when restoring history', () => {
    const input = [
      '有点啰嗦',
      '',
      '[引用片段] 脚本-Kimi多智能体.md（第17-17行，共34字）路径: /Users/test/脚本-Kimi多智能体.md',
      '[引用原文]',
      'ChatGPT 2022 年底刚出来的时候，大家最先玩的是什么？角色扮演。',
      '[/引用原文]',
    ].join('\n');

    const result = parseUserAttachments(input);

    expect(result.text).toBe('有点啰嗦');
    expect(result.quotedText).toBe('ChatGPT 2022 年底刚出来的时候，大家最先玩的是什么？角色扮演。');
  });
});
