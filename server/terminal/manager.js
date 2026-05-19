/**
 * terminal/manager.js — PTY 会话管理器
 *
 * 职责：
 *   - 创建 / 列出 / 杀死 PTY 会话（基于 node-pty）
 *   - 维护每会话的环形输出 buffer（供 AI 后续读取 + 晚加入的渲染端补帧）
 *   - 通过 EventEmitter 广播 data / exit 事件给所有订阅者（WS 客户端 + 未来的 AI 工具）
 *
 * 设计要点：
 *   - 所有会话集中在 server 进程内，AI 工具可直接进程内调用
 *   - 渲染端通过 WS /api/terminal/:id/stream 订阅 IO
 *   - cwd / shell 在 create 时确定，整个生命周期不变
 */

import os from "node:os";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import crypto from "node:crypto";

// node-pty 是原生 CJS 模块，ESM 下用 createRequire 加载更稳
const require = createRequire(import.meta.url);

let _ptyModule = null;
function loadPty() {
  if (_ptyModule) return _ptyModule;
  try {
    _ptyModule = require("node-pty");
  } catch (err) {
    throw new Error(`node-pty 未安装或加载失败: ${err.message}`);
  }
  return _ptyModule;
}

const BUFFER_BYTES = 256 * 1024; // 每会话保留 256KB 输出（约满屏 2000 行）
const MAX_TERMS = 32;            // 安全上限

function defaultShell() {
  if (process.platform === "win32") {
    // 优先 PowerShell 7（pwsh），回退到 Windows PowerShell，最后 cmd
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

class TerminalSession {
  constructor({ id, pty, cwd, shell, title }) {
    this.id = id;
    this.pty = pty;
    this.cwd = cwd;
    this.shell = shell;
    this.title = title || `Terminal ${id.slice(0, 6)}`;
    this.createdAt = Date.now();
    this.alive = true;
    this.exitCode = null;
    this.exitSignal = null;
    /** @type {Buffer[]} 环形 buffer 片段 */
    this._chunks = [];
    this._totalBytes = 0;
    /** 累计字节序号（每个 data chunk 后加），让 AI 工具能 sinceSeq 增量读 */
    this._cursor = 0;
    /** 人类用户从 UI 主动按下「打断」按钮的历史。AI 据此判断是否被人类中止。 */
    this.humanInterrupts = [];
    /**
     * 是否处于「人类刚刚打断、AI 还没向用户做出回应」的悬挂状态。
     * 在该状态下，AI 对本会话的写入类操作（terminal_write / terminal_interrupt / terminal_kill）
     * 会被拒绝，强制它先向用户致歉、确认意图。AI 一旦产生新的可见 text 回复，
     * server/routes/chat.js 会调 clearHumanInterruptPending() 自动放闸。
     */
    this.humanInterruptPending = false;
    this.events = new EventEmitter();
    this.events.setMaxListeners(50);
  }

  _appendBuffer(data) {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    this._chunks.push(buf);
    this._totalBytes += buf.length;
    this._cursor += buf.length;
    while (this._totalBytes > BUFFER_BYTES && this._chunks.length > 1) {
      const dropped = this._chunks.shift();
      this._totalBytes -= dropped.length;
    }
  }

  /** 取最近 N 字节快照（解码为字符串，含 ANSI 转义） */
  snapshot({ tail = BUFFER_BYTES } = {}) {
    const total = Buffer.concat(this._chunks, this._totalBytes);
    if (tail >= total.length) return total.toString("utf8");
    return total.slice(total.length - tail).toString("utf8");
  }

  /** 当前 cursor（最新字节流位置） */
  get cursor() { return this._cursor; }

  /**
   * 按 cursor 范围取切片 [from, to)。
   * 由于 ring buffer 只保留最近 BUFFER_BYTES 字节，超出窗口的早期数据无法回溯；
   * 此时返回当前 ring buffer 内与 [from, to) 相交的部分，前端要提示「部分缺失」。
   * @returns {{ text: string, from: number, to: number, truncatedStart: boolean }}
   */
  sliceByCursor(from, to) {
    const cur = this._cursor;
    if (!Number.isFinite(from)) from = Math.max(0, cur - this._totalBytes);
    if (!Number.isFinite(to)) to = cur;
    from = Math.max(0, from | 0);
    to = Math.max(from, Math.min(cur, to | 0));
    if (to === from) return { text: "", from, to, truncatedStart: false };

    const total = Buffer.concat(this._chunks, this._totalBytes);
    const bufStart = cur - total.length; // 当前 ring buffer 对应的 cursor 起点
    const truncatedStart = from < bufStart;
    const sliceFrom = Math.max(0, from - bufStart);
    const sliceTo = Math.max(sliceFrom, to - bufStart);
    return {
      text: total.slice(sliceFrom, sliceTo).toString("utf8"),
      from,
      to,
      truncatedStart,
    };
  }

  write(data) {
    if (!this.alive) return false;
    this.pty.write(data);
    return true;
  }

  resize(cols, rows) {
    if (!this.alive) return false;
    try {
      this.pty.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
      return true;
    } catch { return false; }
  }

  kill(signal) {
    if (!this.alive) return false;
    try { this.pty.kill(signal); } catch {}
    return true;
  }

  /** 发送 Ctrl+C（中断前台进程，shell 不退出） */
  interrupt() {
    return this.write("\x03");
  }

  /**
   * 由人类用户从 UI 主动按下「打断」按钮触发的中断。
   * 与 AI 的 terminal_interrupt 工具区分：记录一条 humanInterrupts 标记，
   * 让 AI 在下一次 terminal_read / terminal_wait 时能知道是用户而不是程序自己退出的。
   */
  humanInterrupt() {
    const at = Date.now();
    const cursor = this._cursor;
    if (!Array.isArray(this.humanInterrupts)) this.humanInterrupts = [];
    const entry = { cursor, at };
    this.humanInterrupts.push(entry);
    // 限长，避免长生命周期会话无限累积
    if (this.humanInterrupts.length > 64) {
      this.humanInterrupts.splice(0, this.humanInterrupts.length - 64);
    }
    // 高优先级事件：先于 PTY 的 ^C 回显抵达，waitFor 立刻唤醒，
    // 让正在 idle_ms 等待中的 AI 不必再等 300ms 才感知。
    this.humanInterruptPending = true;
    try { this.events.emit("human_interrupt", entry); } catch {}
    return this.interrupt();
  }

  /** 放闸：AI 已经向用户做出新的可见 text 回复，允许它再次对终端写入。 */
  clearHumanInterruptPending() {
    this.humanInterruptPending = false;
  }

  /**
   * 等待会话发生"值得汇报"的状态变化，立即返回。
   *
   * 触发条件（任意一个先满足即解决）：
   *   - 新输出到达且累计 cursor > sinceCursor（如果指定了 idleMs，则还要 idle 静默期）
   *   - 会话退出（exit 事件）
   *   - 超时（timeoutMs）
   *   - 取消信号（外部 abort）
   *
   * @param {object} opts
   * @param {number} opts.sinceCursor  起始游标（之前已读到的字节数）；默认 = 当前 cursor，表示"等新数据"
   * @param {number} [opts.timeoutMs]  超时上限，默认 5000，最大 60000
   * @param {number} [opts.idleMs]     可选静默窗口；首字节到达后，再等 idleMs 没有新数据才返回（用于抓取完整输出）
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{ reason: "exited"|"data"|"idle"|"timeout"|"aborted", cursor: number, alive: boolean, sinceCursor: number }>}
   */
  waitFor({ sinceCursor, timeoutMs = 5000, idleMs, signal } = {}) {
    const startCursor = Number.isFinite(sinceCursor) ? sinceCursor : this._cursor;
    const cappedTimeout = Math.min(Math.max(timeoutMs | 0, 50), 60_000);
    const useIdle = Number.isFinite(idleMs) && idleMs > 0;
    const cappedIdle = useIdle ? Math.min(Math.max(idleMs | 0, 10), 10_000) : 0;

    return new Promise((resolve) => {
      let resolved = false;
      let idleTimer = null;
      let hardTimer = null;
      let dataListener = null;
      let exitListener = null;
      let humanInterruptListener = null;
      let onAbort = null;

      const finish = (reason) => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (dataListener) this.events.off("data", dataListener);
        if (exitListener) this.events.off("exit", exitListener);
        if (humanInterruptListener) this.events.off("human_interrupt", humanInterruptListener);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
        resolve({
          reason,
          cursor: this._cursor,
          alive: this.alive,
          sinceCursor: startCursor,
          exitCode: this.exitCode,
          exitSignal: this.exitSignal,
        });
      };

      // 会话已死：立即返回
      if (!this.alive) {
        finish("exited");
        return;
      }

      // 已有未读字节：立即返回（避免 race）
      if (this._cursor > startCursor && !useIdle) {
        finish("data");
        return;
      }

      dataListener = () => {
        if (useIdle) {
          // 静默窗口：每次有新数据就重置 idle timer，直到静默 idleMs
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => finish("idle"), cappedIdle);
        } else {
          finish("data");
        }
      };
      exitListener = () => finish("exited");
      // 人类按打断按钮 → 立即唤醒，优先级最高，绕过 idle 等待。
      humanInterruptListener = () => finish("human_interrupt");
      this.events.on("data", dataListener);
      this.events.on("exit", exitListener);
      this.events.on("human_interrupt", humanInterruptListener);

      hardTimer = setTimeout(() => finish("timeout"), cappedTimeout);

      if (signal) {
        if (signal.aborted) { finish("aborted"); return; }
        onAbort = () => finish("aborted");
        signal.addEventListener("abort", onAbort);
      }

      // 如果开 idle 模式但之前已有未读字节，立刻启动 idle 计时（不需要等"新"数据触发）
      if (useIdle && this._cursor > startCursor) {
        idleTimer = setTimeout(() => finish("idle"), cappedIdle);
      }
    });
  }
}

class TerminalManager {
  constructor() {
    /** @type {Map<string, TerminalSession>} */
    this._sessions = new Map();
    this.globalEvents = new EventEmitter(); // 'created' / 'exited'
    this.globalEvents.setMaxListeners(50);
  }

  list() {
    return Array.from(this._sessions.values()).map(s => ({
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      shell: s.shell,
      alive: s.alive,
      createdAt: s.createdAt,
      exitCode: s.exitCode,
      exitSignal: s.exitSignal,
      cursor: s.cursor,
    }));
  }

  get(id) {
    return this._sessions.get(id) || null;
  }

  create({ cwd, shell, cols = 80, rows = 24, title, env } = {}) {
    if (this._sessions.size >= MAX_TERMS) {
      throw new Error(`已达终端数量上限 (${MAX_TERMS})`);
    }
    const pty = loadPty();
    const useShell = shell || defaultShell();
    const useCwd = cwd && typeof cwd === "string" ? cwd : os.homedir();
    const useEnv = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", ...(env || {}) };

    // Windows 下若 shell 是 powershell，附加 NoLogo 减少噪音输出
    let args = [];
    if (process.platform === "win32" && /powershell/i.test(useShell)) {
      args = ["-NoLogo"];
    }

    const proc = pty.spawn(useShell, args, {
      name: "xterm-256color",
      cols: Math.max(1, cols | 0),
      rows: Math.max(1, rows | 0),
      cwd: useCwd,
      env: useEnv,
      // ConPTY on Windows; default on others
    });

    const id = newId();
    const session = new TerminalSession({ id, pty: proc, cwd: useCwd, shell: useShell, title });

    proc.onData((data) => {
      session._appendBuffer(data);
      session.events.emit("data", data, session._cursor);
    });

    proc.onExit(({ exitCode, signal }) => {
      session.alive = false;
      session.exitCode = typeof exitCode === "number" ? exitCode : null;
      session.exitSignal = signal != null ? String(signal) : null;
      session.events.emit("exit", { exitCode: session.exitCode, signal: session.exitSignal });
      this.globalEvents.emit("exited", { id });
      // 保留 5 分钟便于 AI 读取最后输出，再清掉
      setTimeout(() => {
        if (this._sessions.get(id) === session) this._sessions.delete(id);
      }, 5 * 60 * 1000).unref?.();
    });

    this._sessions.set(id, session);
    this.globalEvents.emit("created", { id });
    return session;
  }

  kill(id, signal) {
    const s = this._sessions.get(id);
    if (!s) return false;
    return s.kill(signal);
  }

  /** 进程关闭时清理所有 PTY */
  shutdown() {
    for (const s of this._sessions.values()) {
      try { s.kill(); } catch {}
    }
    this._sessions.clear();
  }
}

// 单例
export const terminalManager = new TerminalManager();
export { TerminalManager, TerminalSession };
