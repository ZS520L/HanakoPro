import { beforeAll, describe, expect, it, vi } from 'vitest';

const t = (key: string) => key;

let buildSlashCommands: typeof import('../../components/input/slash-commands').buildSlashCommands;
let resolveSlashSubmitSelection: typeof import('../../components/input/slash-commands').resolveSlashSubmitSelection;
let XING_PROMPT: typeof import('../../components/input/slash-commands').XING_PROMPT;

beforeAll(async () => {
  vi.stubGlobal('window', { i18n: { locale: 'zh' } });
  ({ buildSlashCommands, resolveSlashSubmitSelection, XING_PROMPT } = await import('../../components/input/slash-commands'));
});

function makeCommands() {
  return buildSlashCommands(
    t,
    async () => {},
    async () => {},
    async () => {},
  );
}

describe('resolveSlashSubmitSelection', () => {
  it('keeps learned-skill extraction focused on workflows instead of user profile memory', () => {
    expect(XING_PROMPT).toContain('不要把用户的个人画像');
    expect(XING_PROMPT).toContain('只把“以后遇到类似任务应该怎么做”的内容写成自学技能');
    expect(XING_PROMPT).not.toContain('工作流程、偏好和纠正');
  });

  it('returns the matching slash command for an unfinished slash input', () => {
    const commands = makeCommands();

    const result = resolveSlashSubmitSelection({
      text: '/compa',
      skills: [],
      commands,
      selectedIndex: 0,
      dismissedText: null,
    });

    expect(result?.name).toBe('compact');
  });

  it('does not auto-select when the current slash text was explicitly dismissed', () => {
    const commands = makeCommands();

    const result = resolveSlashSubmitSelection({
      text: '/compa',
      skills: [],
      commands,
      selectedIndex: 0,
      dismissedText: '/compa',
    });

    expect(result).toBeNull();
  });
});
