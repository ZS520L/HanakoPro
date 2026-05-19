/**
 * slash-commands.ts — 斜杠命令定义和执行逻辑
 *
 * 从 InputArea.tsx 提取，减少主组件体量。
 */

import { hanaFetch } from '../../hooks/use-hana-fetch';
import { getWebSocket } from '../../services/websocket';
import { useStore } from '../../stores';

// ── Xing Prompt ──

const isZh = window.i18n?.locale?.startsWith?.('zh') ?? true;

export const XING_PROMPT = isZh
  ? `回顾本次对话中我（用户）发送的消息，提取可复用的工作流程、纠正和操作经验。

不要把用户的个人画像、审美喜好、兴趣、生活近况写进技能；这些属于记忆系统。
只把“以后遇到类似任务应该怎么做”的内容写成自学技能。

你必须先查阅 skill-creator 技能，按照其中 "Capture Intent" 和 "Write the SKILL.md" 部分的流程操作。
只做到创建并安装为止，不需要做 eval、benchmark 或 description optimization。

最终调用 install_skill 工具将技能安装为自学技能（skill_content + skill_name 模式）。`
  : `Review the messages I (the user) sent in this session and extract reusable workflows, corrections, and operational lessons.

Do not write the user's personal profile, aesthetic tastes, interests, or life/current-state context into a skill; those belong in memory.
Only turn "how to handle similar tasks in the future" into a learned skill.

You must first consult the skill-creator skill, following its "Capture Intent" and "Write the SKILL.md" sections.
Only go as far as creating and installing — do not run evals, benchmarks, or description optimization.

Use the install_skill tool to install the skill as a learned skill (skill_content + skill_name mode).`;

// ── Slash Command Interface ──

export interface SlashItem {
  name: string;
  label: string;
  description: string;
  busyLabel: string;
  icon: string;
  type: 'builtin' | 'skill';
  execute: () => Promise<void> | void;
}

export const MAX_SLASH_TRIGGER_LENGTH = 20;

export function getSlashMatches(text: string, commands: SlashItem[]): SlashItem[] {
  const normalized = text.trim();
  if (!normalized.startsWith('/') || normalized.length > MAX_SLASH_TRIGGER_LENGTH) return [];
  const query = normalized.slice(1).toLowerCase();
  return commands.filter(command => command.name.startsWith(query));
}

export function resolveSlashSubmitSelection({
  text,
  skills,
  commands,
  selectedIndex,
  dismissedText,
}: {
  text: string;
  skills: string[];
  commands: SlashItem[];
  selectedIndex: number;
  dismissedText: string | null;
}): SlashItem | null {
  if (skills.length > 0) return null;
  const matches = getSlashMatches(text, commands);
  if (matches.length === 0) return null;
  if (dismissedText === text.trim()) return null;
  return matches[selectedIndex] || matches[0] || null;
}

// ── Command Executors ──

type ToastType = 'success' | 'error' | 'info' | 'warning';
type AddToast = (
  text: string,
  type?: ToastType,
  duration?: number,
  opts?: { persistent?: boolean; dedupeKey?: string },
) => number | null;
type RemoveToast = (id: number) => void;

const DIARY_WRITE_TIMEOUT_MS = 150_000;

export function executeDiary(
  t: (key: string) => string,
  addToast: AddToast,
  removeToast: RemoveToast,
  setInput: (text: string) => void,
  setMenuOpen: (open: boolean) => void,
): () => void {
  return () => {
    setInput('');
    setMenuOpen(false);
    const progressToastId = addToast(t('slash.diaryBusy'), 'info', 0, {
      persistent: true,
      dedupeKey: 'slash-diary-progress',
    });

    void (async () => {
      try {
        const res = await hanaFetch('/api/diary/write', {
          method: 'POST',
          timeout: DIARY_WRITE_TIMEOUT_MS,
        });
        const data = await res.json();
        if (progressToastId !== null) removeToast(progressToastId);
        if (!res.ok || data.error) {
          addToast(data.error || t('slash.diaryFailed'), 'error', 6000);
          return;
        }
        addToast(t('slash.diaryDone'), 'success', 5000);
      } catch {
        if (progressToastId !== null) removeToast(progressToastId);
        addToast(t('slash.diaryFailed'), 'error', 6000);
      }
    })();
  };
}

export function executeCompact(
  setBusy: (name: string | null) => void,
  setInput: (text: string) => void,
  setMenuOpen: (open: boolean) => void,
): () => Promise<void> {
  return async () => {
    setBusy('compact');
    setInput('');
    setMenuOpen(false);
    try {
      const ws = getWebSocket();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'compact', sessionPath: useStore.getState().currentSessionPath }));
      }
    } finally {
      setTimeout(() => setBusy(null), 1500);
    }
  };
}

/**
 * 通用的 WS slash 命令发送器。
 * 一期服务 /stop /new /reset 三条系统命令；未来扩展时（插件命令、skill 命令）也共用这条 WS 通道。
 * 后端在 server/routes/chat.js 接收 {type:'slash'}，走 engine.slashDispatcher.tryDispatch。
 *
 * TODO(frontend): 服务端会通过 WS {type:'slash_result'} 回复结果（未知命令 / handler reply），
 *   目前前端没有 consumer——/new /reset 的 not-found、已归档等 distinct reply 无法显示给用户。
 *   下一步应在 ws-message-handler.ts 加 slash_result 分支，把 text 展示到 slashResult state。
 *   当前的 800ms setBusy(null) 只是视觉 hack，不等真正执行完成。
 */
export function executeSlashViaWs(
  cmd: string,
  setBusy: (name: string | null) => void,
  setInput: (text: string) => void,
  setMenuOpen: (open: boolean) => void,
): () => Promise<void> {
  return async () => {
    setBusy(cmd);
    setInput('');
    setMenuOpen(false);
    try {
      const ws = getWebSocket();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'slash',
          text: '/' + cmd,
          sessionPath: useStore.getState().currentSessionPath,
        }));
      }
    } finally {
      setTimeout(() => setBusy(null), 800);
    }
  };
}

export function buildSlashCommands(
  t: (key: string) => string,
  executeDiaryFn: () => Promise<void> | void,
  executeXingFn: () => Promise<void>,
  executeCompactFn: () => Promise<void>,
  slashViaWsFactory?: (cmd: string) => () => Promise<void>,
): SlashItem[] {
  const list: SlashItem[] = [
    {
      name: 'diary',
      label: '/diary',
      description: t('slash.diary'),
      busyLabel: t('slash.diaryBusy'),
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
      type: 'builtin',
      execute: executeDiaryFn,
    },
    {
      name: 'xing',
      label: '/xing',
      description: t('slash.xing'),
      busyLabel: '',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>',
      type: 'builtin',
      execute: executeXingFn,
    },
    {
      name: 'compact',
      label: '/compact',
      description: t('slash.compact'),
      busyLabel: t('slash.compactBusy'),
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
      type: 'builtin',
      execute: executeCompactFn,
    },
  ];
  // slashViaWsFactory 由 InputArea 注入；没传则兼容既有调用方（如测试）
  if (slashViaWsFactory) {
    list.push(
      {
        name: 'stop',
        label: '/stop',
        description: t('slash.stop'),
        busyLabel: '',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
        type: 'builtin',
        execute: slashViaWsFactory('stop'),
      },
      {
        name: 'new',
        label: '/new',
        description: t('slash.new'),
        busyLabel: '',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
        type: 'builtin',
        execute: slashViaWsFactory('new'),
      },
      {
        name: 'reset',
        label: '/reset',
        description: t('slash.reset'),
        busyLabel: '',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/></svg>',
        type: 'builtin',
        execute: slashViaWsFactory('reset'),
      },
    );
  }
  return list;
}
