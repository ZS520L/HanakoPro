/**
 * terminal-tools.js — AI 工具：与共享终端会话交互
 *
 * 这些工具与 desktop terminal window 共享同一个 PTY 池（server/terminal/manager.js）。
 *
 * 只读类（INFORMATION_TOOLS，永远 allow）：
 *   - terminal_list                 列出当前所有 PTY 会话（id/cwd/alive...）
 *   - terminal_read                 读取某会话的输出快照（含 ANSI），可指定 tail 字节
 *
 * 副作用类（SIDE_EFFECT_TOOLS，ASK 模式下走许可）：
 *   - terminal_create               新建一个 PTY 会话（独立 cmd/shell 进程）
 *   - terminal_write                向会话 stdin 写入文本
 *                                   注意：要让命令真正执行，文本末尾需带 "\r" 或 "\n"
 *   - terminal_interrupt            发送 Ctrl+C（中断前台进程，shell 不退出）
 *   - terminal_kill                 杀死整个会话（含 shell）
 *
 * 实现：直接 in-process 调 terminalManager。session-permission-wrapper 在 engine 层
 * 已自动包一圈，按 tool 名 + 模式决定是否弹许可。本文件只关心业务语义。
 */

import { Type } from "../pi-sdk/index.js";
import { toolOk, toolError } from "./tool-result.js";
import { terminalManager } from "../../server/terminal/manager.js";

// eslint-disable-next-line no-control-regex -- 正是要匹配 ANSI 控制字符来剥掉颜色序列
const ANSI_CURSOR_LINE_START = /\x1b\[(?:\d+;)?1H/g;
const ANSI_STRIP = /\x1b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(s) {
  return typeof s === "string" ? s.replace(ANSI_CURSOR_LINE_START, "\n").replace(ANSI_STRIP, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n") : "";
}

/**
 * 人类用户在 UI 上按了「打断」按钮后，本会话进入挂起状态：所有 terminal_* 工具调用
 * 都直接拒绝，AI 完全看不到中断后的 PTY 输出（^C / KeyboardInterrupt 等）。
 * 强制 AI 用一段自然语言向用户致歉、询问意图，等用户发新消息时
 * server/routes/chat.js 会调 clearHumanInterruptPending() 自动放闸。
 *
 * 这是最高优先级的硬约束，不依赖模型遵守提示词。
 */
function guardHumanInterruptPending(session) {
  if (!session?.humanInterruptPending) return null;
  return toolError(
    `用户刚刚按了「打断」按钮中止了本会话上正在跑的命令。当前不允许对该终端做任何操作（write / read / wait / interrupt / kill）。请先用一句自然的话向用户致歉、询问下一步意图，等用户回复你的新消息后才可以再调用 terminal_*。`,
    { id: session.id, blockedReason: "human_interrupt_pending" },
  );
}

function summarizeSession(s) {
  return {
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    shell: s.shell,
    alive: s.alive,
    createdAt: s.createdAt,
    cursor: s.cursor,
    exitCode: s.exitCode,
    exitSignal: s.exitSignal,
  };
}

// ── terminal_list ─────────────────────────────────────────────────────────────
export function createTerminalListTool() {
  return {
    name: "terminal_list",
    label: "列出终端会话",
    description: [
      "列出当前所有共享终端会话（人类用户与 AI 共用同一池，档位于桌面 Terminal 窗口）。",
      "返回每个会话的 id、cwd、shell、alive 状态和最新字节游标 cursor。",
      "运行任何可能被用户观察、可能超过几秒、或可能需要中途打断的命令前，先调 terminal_list 看看能不能复用现有会话，并优先走 terminal_* 路径而不是 bash。",
    ].join(" "),
    parameters: Type.Object({}),
    execute: async () => {
      const list = terminalManager.list().map(summarizeSession);
      const lines = list.length === 0
        ? ["(没有打开的终端)"]
        : list.map(t => `${t.id}  alive=${t.alive}  shell=${t.shell}  cwd=${t.cwd}  cursor=${t.cursor}`);
      return toolOk(lines.join("\n"), { terminals: list });
    },
  };
}

// ── terminal_read ─────────────────────────────────────────────────────────────
export function createTerminalReadTool() {
  return {
    name: "terminal_read",
    label: "读取终端输出",
    description: [
      "读取指定终端会话的最近输出（PTY 屏幕缓冲快照）。",
      "默认返回最近 8KB；可通过 tail 调整（最大 256KB）。",
      "默认会去掉 ANSI 转义码（颜色/光标控制）便于 LLM 阅读；如需原始 ANSI 设 keep_ansi=true。",
      "details.humanInterrupts 是用户点「打断」按钮的历史（{cursor, at}），非空且最新一条 cursor 临近当前 cursor 表示刚被用户中止。",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String({ description: "终端会话 id（来自 terminal_list / terminal_create）" }),
      tail: Type.Optional(Type.Number({ description: "返回最近多少字节，默认 8192，最大 262144" })),
      keep_ansi: Type.Optional(Type.Boolean({ description: "是否保留 ANSI 转义码，默认 false" })),
    }),
    execute: async (_id, params = {}) => {
      const session = terminalManager.get(params.id);
      if (!session) return toolError(`找不到终端会话: ${params.id}`, { id: params.id });
      const gated = guardHumanInterruptPending(session);
      if (gated) return gated;
      const tail = Math.min(Math.max(parseInt(params.tail, 10) || 8192, 256), 256 * 1024);
      const raw = session.snapshot({ tail });
      const out = params.keep_ansi ? raw : stripAnsi(raw);
      // 同时把 output 对外曝露在 details 里，让对话内嵌终端卡片能拿到该调用瞬间的静态快照，
      // 不再靠 WS 去拉实时尾部（避免同一会话的多轮卡片都显示类似的「最后状态」）。
      // 限长以避免写入 JSONL 过肥。
      const PREVIEW_CAP = 16 * 1024;
      const previewOutput = out.length > PREVIEW_CAP ? out.slice(out.length - PREVIEW_CAP) : out;
      return toolOk(out, {
        id: session.id,
        alive: session.alive,
        cursor: session.cursor,
        exitCode: session.exitCode,
        bytes: out.length,
        output: previewOutput,
        outputTruncated: out.length > PREVIEW_CAP,
        humanInterrupts: Array.isArray(session.humanInterrupts) ? session.humanInterrupts : [],
      });
    },
  };
}

// ── terminal_wait ─────────────────────────────────────────────────────────────
export function createTerminalWaitTool() {
  return {
    name: "terminal_wait",
    label: "等待终端变化",
    description: [
      "阻塞等待指定终端会话发生「值得汇报」的状态变化，事件驱动，一发生就立即返回。",
      "用这个工具替代通用的 wait — 当用户中途 Ctrl+C 杀掉终端、命令提前退出、新输出到达时，能在毫秒级感知到。",
      "典型用法：terminal_write 提交命令 → terminal_wait（带 idle_ms=300 抓完整输出 / 或 timeout_ms=10000 等长跑命令） → terminal_read 读结果。",
      "返回的 reason 字段告诉你为什么醒来：",
      "  human_interrupt = 用户从 UI 按了打断按钮（最高优先级，会立即唤醒）；",
      "  exited = 会话退出（用户关闭或 shell 自己 exit）；",
      "  data   = 有新输出到达（不带 idle_ms）；",
      "  idle   = 输出已稳定（带 idle_ms，连续 idle_ms 毫秒无新输出）；",
      "  timeout= 超时未等到事件。",
      "details.humanInterrupts 为用户点打断的全部历史，details.humanInterruptsInWindow 为本轮 wait 区间内的那几条。",
      "since_cursor 默认 = 当前 cursor，表示「从现在起等新数据」。如要等某次写入之后的新输出，传 terminal_write 之前的 cursor 值。",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String({ description: "终端会话 id" }),
      timeout_ms: Type.Optional(Type.Number({ description: "最大等待毫秒数，默认 5000，最大 60000" })),
      idle_ms: Type.Optional(Type.Number({ description: "静默窗口：首字节到达后再等这么多毫秒没新数据才返回（10-10000，常用 300）" })),
      since_cursor: Type.Optional(Type.Number({ description: "起始游标（来自 terminal_list / terminal_read 的 cursor）；默认 = 当前 cursor" })),
    }),
    execute: async (_id, params = {}) => {
      const session = terminalManager.get(params.id);
      if (!session) return toolError(`找不到终端会话: ${params.id}`, { id: params.id });
      const gated = guardHumanInterruptPending(session);
      if (gated) return gated;
      const result = await session.waitFor({
        sinceCursor: Number.isFinite(params.since_cursor) ? params.since_cursor : undefined,
        timeoutMs: Number.isFinite(params.timeout_ms) ? params.timeout_ms : 5000,
        idleMs: Number.isFinite(params.idle_ms) ? params.idle_ms : undefined,
      });
      const summary = `reason=${result.reason} alive=${result.alive} cursor=${result.cursor}` +
        (result.reason === "exited" ? ` exitCode=${result.exitCode}${result.exitSignal ? ` signal=${result.exitSignal}` : ""}` : "");
      // 把 [sinceCursor, cursor) 期间产生的输出切片随 details 返回，让对话卡片可以静态渲染「这一轮
      // 命令产生的输出」，而不是订阅 PTY 实时尾部。这样同一会话跨很多轮的多张卡片能各自
      // 显示那一轮的真实快照，而不会看起来重复。
      let outputText = "";
      let truncatedStart = false;
      try {
        const slice = session.sliceByCursor(result.sinceCursor, result.cursor);
        outputText = stripAnsi(slice.text || "");
        truncatedStart = !!slice.truncatedStart;
      } catch { /* ignore */ }
      const PREVIEW_CAP = 16 * 1024;
      const previewOutput = outputText.length > PREVIEW_CAP
        ? outputText.slice(outputText.length - PREVIEW_CAP)
        : outputText;
      const allInterrupts = Array.isArray(session.humanInterrupts) ? session.humanInterrupts : [];
      const interruptsInWindow = allInterrupts.filter(
        (entry) => entry && entry.cursor >= result.sinceCursor && entry.cursor <= result.cursor,
      );
      return toolOk(summary, {
        id: session.id,
        ...result,
        output: previewOutput,
        outputTruncated: outputText.length > PREVIEW_CAP || truncatedStart,
        humanInterrupts: allInterrupts,
        humanInterruptsInWindow: interruptsInWindow,
      });
    },
  };
}

// ── terminal_create ───────────────────────────────────────────────────────────
export function createTerminalCreateTool({ defaultCwd } = {}) {
  return {
    name: "terminal_create",
    label: "新建终端会话",
    description: [
      "新建一个 PTY 终端会话（独立 shell 进程，与人类用户共享桌面 Terminal 窗口）。",
      "需要运行一个可见、可能长期跑、或可能要打断的命令时 —— 比如 ping、npm run dev、watch、构建、下载、或不确定会跑多久的任何脚本 —— 先调这个创建会话，再 terminal_write 的命令。不要用 bash 运行这类命令：bash 会阻塞直到命令退出且无法中途打断。",
      "默认 cwd 为当前会话工作目录；shell 在 Windows 上为 cmd.exe，在 *nix 上为 $SHELL。",
      "新会话同步出现在桌面终端窗口的 tab 列表里，人类用户能实时看到 AI 创建的会话和输出。",
      "返回新会话的 id，后续用 terminal_read / terminal_write 等操作。",
    ].join(" "),
    parameters: Type.Object({
      cwd: Type.Optional(Type.String({ description: "工作目录绝对路径（默认 = 当前会话工作目录）" })),
      shell: Type.Optional(Type.String({ description: "shell 可执行路径（高级用法，慎用）" })),
      title: Type.Optional(Type.String({ description: "tab 标题，便于人类识别" })),
      cols: Type.Optional(Type.Number({ description: "列数，默认 100" })),
      rows: Type.Optional(Type.Number({ description: "行数，默认 30" })),
    }),
    execute: async (_id, params = {}) => {
      try {
        const session = terminalManager.create({
          cwd: params.cwd || defaultCwd,
          shell: params.shell,
          title: params.title,
          cols: Number.isFinite(params.cols) ? params.cols : 100,
          rows: Number.isFinite(params.rows) ? params.rows : 30,
        });
        return toolOk(
          `已创建终端会话 id=${session.id}, shell=${session.shell}, cwd=${session.cwd}`,
          summarizeSession(session),
        );
      } catch (err) {
        return toolError(`创建终端失败: ${err.message}`);
      }
    },
  };
}

// ── terminal_write ────────────────────────────────────────────────────────────
export function createTerminalWriteTool() {
  return {
    name: "terminal_write",
    label: "向终端写入",
    description: [
      "向指定终端会话的 stdin 写入文本，与人类用户共享同一个 shell。",
      "需要跑一条人类用户看得见、可随时打断、可能超过几秒的命令时，首选这个工具 + terminal_create / terminal_interrupt，不要用 bash。",
      "默认行为：如果 text 不以 \\r 或 \\n 结尾，会自动追加 \\r 让命令立即执行。",
      "也就是说传 'dir' 等价于传 'dir\\r'，shell 会真的执行 dir 并输出结果。",
      "如果你只是想往输入行里填一段文字（不立刻提交，等用户继续输入），设 enter=false。",
      "调完后等几百毫秒再用 terminal_read 看结果，太快可能 shell 还没产出输出。",
      "ASK 权限模式下，每次调用都会弹用户许可。",
      "如要中断已在跑的命令，用 terminal_interrupt（发 Ctrl+C）。",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String({ description: "终端会话 id" }),
      text: Type.String({ description: "要写入 stdin 的文本（默认会自动加回车执行）" }),
      enter: Type.Optional(Type.Boolean({
        description: "是否在 text 末尾自动追加 \\r 让命令执行（默认 true）。设 false 表示只填字不执行。",
      })),
    }),
    execute: async (_id, params = {}) => {
      const session = terminalManager.get(params.id);
      if (!session) return toolError(`找不到终端会话: ${params.id}`, { id: params.id });
      if (!session.alive) return toolError(`终端会话已结束: ${params.id}`, { id: params.id });
      const gated = guardHumanInterruptPending(session);
      if (gated) return gated;
      let text = typeof params.text === "string" ? params.text : "";
      const wantEnter = params.enter !== false; // 默认 true
      const alreadyHasEnter = /[\r\n]$/.test(text);
      if (wantEnter && !alreadyHasEnter) text += "\r";
      // 写入前的 cursor —— 让对话内嵌终端卡片可以拉 [cursorBefore, latest cursor) 这段
      // 整体输出（即"这条命令产生了什么"），而不是只看最后一次 wait 的局部切片。
      const cursorBefore = session.cursor;
      const ok = session.write(text);
      if (!ok) return toolError(`写入失败`, { id: session.id });
      // 持久化保底快照：把当前 ring buffer 的最近内容塞进 details.output。
      // 即使本 turn AI 之后没调 terminal_wait / terminal_read，等 server 重启回放
      // 历史对话时也还能看到「这一刻终端屏幕上的内容」（含 prompt 行、命令本身、
      // 已经回显的字节）。capped 16KB，避免 JSONL 过肥。
      const PREVIEW_CAP = 16 * 1024;
      const rawSnapshot = session.snapshot({ tail: PREVIEW_CAP });
      const snapshot = stripAnsi(rawSnapshot);
      return toolOk(
        `已写入 ${text.length} 字符到终端 ${session.id}${wantEnter && !alreadyHasEnter ? "（已自动追加回车）" : ""}`,
        {
          id: session.id,
          bytes: text.length,
          autoEnter: wantEnter && !alreadyHasEnter,
          cursorBefore,
          cursor: session.cursor,
          output: snapshot,
          outputTruncated: rawSnapshot.length >= PREVIEW_CAP,
          alive: session.alive,
        },
      );
    },
  };
}

// ── terminal_interrupt ────────────────────────────────────────────────────────
export function createTerminalInterruptTool() {
  return {
    name: "terminal_interrupt",
    label: "打断终端进程",
    description: [
      "向终端会话发送 Ctrl+C（ETX, 0x03），用于中断当前在跑的前台命令。",
      "这不会杀掉 shell 本身，只会中断 shell 里跑的子进程。",
      "如要杀掉整个 shell（含会话），用 terminal_kill。",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String({ description: "终端会话 id" }),
    }),
    execute: async (_id, params = {}) => {
      const session = terminalManager.get(params.id);
      if (!session) return toolError(`找不到终端会话: ${params.id}`, { id: params.id });
      if (!session.alive) return toolError(`终端会话已结束: ${params.id}`, { id: params.id });
      const gated = guardHumanInterruptPending(session);
      if (gated) return gated;
      session.interrupt();
      return toolOk(`已发送 Ctrl+C 到终端 ${session.id}`, { id: session.id });
    },
  };
}

// ── terminal_kill ─────────────────────────────────────────────────────────────
export function createTerminalKillTool() {
  return {
    name: "terminal_kill",
    label: "杀死终端会话",
    description: [
      "杀死整个终端会话（包括 shell 本身和所有子进程）。",
      "会话 tab 在桌面终端窗口里会标记为 (已结束)。",
      "如只想中断单个命令，用 terminal_interrupt。",
    ].join(" "),
    parameters: Type.Object({
      id: Type.String({ description: "终端会话 id" }),
      signal: Type.Optional(Type.String({ description: "可选信号名（默认 SIGTERM；Windows 下忽略）" })),
    }),
    execute: async (_id, params = {}) => {
      const session = terminalManager.get(params.id);
      if (!session) return toolError(`找不到终端会话: ${params.id}`, { id: params.id });
      const gated = guardHumanInterruptPending(session);
      if (gated) return gated;
      const ok = terminalManager.kill(params.id, params.signal);
      return ok
        ? toolOk(`已杀死终端 ${params.id}`, { id: params.id })
        : toolError(`杀死失败（可能已结束）`, { id: params.id });
    },
  };
}

/**
 * 工厂：返回所有 terminal_* 工具的数组，可直接 push 到 createSandboxedTools 的 tools 输出。
 *
 * @param {object} [opts]
 * @param {string} [opts.defaultCwd] terminal_create 的默认 cwd
 */
export function createTerminalTools(opts = {}) {
  return [
    createTerminalListTool(),
    createTerminalReadTool(),
    createTerminalWaitTool(),
    createTerminalCreateTool({ defaultCwd: opts.defaultCwd }),
    createTerminalWriteTool(),
    createTerminalInterruptTool(),
    createTerminalKillTool(),
  ];
}
