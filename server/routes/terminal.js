/**
 * routes/terminal.js — 终端 PTY HTTP/WS 路由
 *
 * REST:
 *   POST /api/terminal/create   { cwd?, shell?, cols?, rows?, title? } -> { id, ...meta }
 *   GET  /api/terminal/list     -> { terminals: [...] }
 *   POST /api/terminal/:id/kill -> { ok }
 *   GET  /api/terminal/:id/snapshot?tail=N -> { id, output, cursor, alive }
 *
 * WebSocket:
 *   /api/terminal/:id/stream
 *   client → server:
 *     { type: "input", data: string }
 *     { type: "resize", cols: number, rows: number }
 *     { type: "interrupt" }                         // Ctrl+C
 *     { type: "kill", signal?: "SIGTERM" | ... }
 *   server → client:
 *     { type: "snapshot", output: string, cursor: number, alive: boolean }   // 首发，便于补帧
 *     { type: "data", data: string, cursor: number }
 *     { type: "exit", exitCode: number|null, signal: string|null }
 */

import { Hono } from "hono";
import { safeJson } from "../hono-helpers.js";
import { wsSend, wsParse } from "../ws-protocol.js";
import { terminalManager } from "../terminal/manager.js";

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

export function createTerminalRoute({ upgradeWebSocket }) {
  const restRoute = new Hono();
  const wsRoute = new Hono();

  restRoute.post("/terminal/create", async (c) => {
    const body = await safeJson(c).catch(() => ({}));
    try {
      const session = terminalManager.create({
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
        shell: typeof body.shell === "string" ? body.shell : undefined,
        cols: Number.isFinite(body.cols) ? body.cols : 80,
        rows: Number.isFinite(body.rows) ? body.rows : 24,
        title: typeof body.title === "string" ? body.title : undefined,
      });
      return c.json({
        ok: true,
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        shell: session.shell,
        alive: session.alive,
        createdAt: session.createdAt,
        cursor: session.cursor,
      });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  restRoute.get("/terminal/list", (c) => {
    return c.json({ terminals: terminalManager.list() });
  });

  restRoute.post("/terminal/:id/kill", (c) => {
    const id = c.req.param("id");
    const ok = terminalManager.kill(id);
    return c.json({ ok });
  });

  /**
   * 人类用户在嵌入式终端卡片上主动按下「打断」按钮：发 Ctrl+C 给 PTY，并在
   * session.humanInterrupts 里记一条标记，让 AI 的 terminal_read / terminal_wait
   * 知道是人类而不是程序自己退出的。
   */
  restRoute.post("/terminal/:id/interrupt-by-human", (c) => {
    const id = c.req.param("id");
    const session = terminalManager.get(id);
    if (!session) return c.json({ ok: false, error: "not found" }, 404);
    if (!session.alive) return c.json({ ok: false, error: "not alive" }, 409);
    const ok = session.humanInterrupt();
    return c.json({
      ok,
      cursor: session.cursor,
      humanInterrupts: session.humanInterrupts,
    });
  });

  /**
   * 取指定 cursor 范围 [from, to) 的输出切片，用于对话内嵌终端卡片
   * 一次性渲染「整组工具调用对应的完整输出」，而不是只看最后一次 wait 的局部切片。
   * 受 ring buffer (~256KB) 限制：from 早于当前窗口的部分会丢失，truncatedStart=true。
   */
  restRoute.get("/terminal/:id/slice", (c) => {
    const id = c.req.param("id");
    const session = terminalManager.get(id);
    if (!session) return c.json({ ok: false, error: "not found" }, 404);
    const from = parseInt(c.req.query("from") || "", 10);
    const to = parseInt(c.req.query("to") || "", 10);
    const slice = session.sliceByCursor(
      Number.isFinite(from) ? from : undefined,
      Number.isFinite(to) ? to : undefined,
    );
    return c.json({
      ok: true,
      id: session.id,
      alive: session.alive,
      cursor: session.cursor,
      exitCode: session.exitCode,
      ...slice,
    });
  });

  restRoute.get("/terminal/:id/snapshot", (c) => {
    const id = c.req.param("id");
    const session = terminalManager.get(id);
    if (!session) return c.json({ ok: false, error: "not found" }, 404);
    const tail = parseInt(c.req.query("tail") || "", 10);
    return c.json({
      ok: true,
      id: session.id,
      alive: session.alive,
      cursor: session.cursor,
      output: session.snapshot({ tail: Number.isFinite(tail) ? tail : undefined }),
    });
  });

  // WebSocket：双向流
  wsRoute.get("/terminal/:id/stream",
    upgradeWebSocket((c) => {
      const id = c.req.param("id");
      let session = null;
      let onData = null;
      let onExit = null;

      return {
        onOpen(_event, ws) {
          session = terminalManager.get(id);
          if (!session) {
            wsSend(ws, { type: "error", error: "terminal not found" });
            try { ws.close(); } catch {}
            return;
          }

          // 首发快照（让晚加入的客户端补回最近输出）
          wsSend(ws, {
            type: "snapshot",
            output: session.snapshot(),
            cursor: session.cursor,
            alive: session.alive,
          });

          onData = (chunk, cursor) => {
            const data = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
            wsSend(ws, { type: "data", data, cursor });
          };
          onExit = ({ exitCode, signal }) => {
            wsSend(ws, { type: "exit", exitCode, signal });
          };
          session.events.on("data", onData);
          session.events.on("exit", onExit);
        },

        onMessage(event, ws) {
          if (!session) return;
          const msg = wsParse(event.data);
          if (!msg) return;
          if (msg.type === "input" && typeof msg.data === "string") {
            session.write(msg.data);
          } else if (msg.type === "resize") {
            session.resize(msg.cols, msg.rows);
          } else if (msg.type === "interrupt") {
            session.interrupt();
          } else if (msg.type === "kill") {
            session.kill(msg.signal);
          } else if (msg.type === "ping") {
            wsSend(ws, { type: "pong" });
          }
        },

        onClose() {
          if (session) {
            if (onData) session.events.off("data", onData);
            if (onExit) session.events.off("exit", onExit);
          }
          session = null;
          onData = null;
          onExit = null;
        },

        onError() {
          if (session) {
            if (onData) session.events.off("data", onData);
            if (onExit) session.events.off("exit", onExit);
          }
        },
      };
    })
  );

  // 全局事件流：终端创建 / 退出。渲染端订阅这个就能在 AI 也创建会话时同步 tab。
  wsRoute.get("/terminal/events",
    upgradeWebSocket(() => {
      let onCreated = null;
      let onExited = null;
      return {
        onOpen(_event, ws) {
          // 首发：当前所有会话快照（让晚加入的 UI 一次性补齐）
          wsSend(ws, {
            type: "snapshot",
            terminals: terminalManager.list(),
          });
          onCreated = ({ id }) => {
            const s = terminalManager.get(id);
            wsSend(ws, { type: "created", terminal: s ? summarizeSession(s) : { id } });
          };
          onExited = ({ id }) => {
            wsSend(ws, { type: "exited", id });
          };
          terminalManager.globalEvents.on("created", onCreated);
          terminalManager.globalEvents.on("exited", onExited);
        },
        onClose() {
          if (onCreated) terminalManager.globalEvents.off("created", onCreated);
          if (onExited) terminalManager.globalEvents.off("exited", onExited);
          onCreated = null; onExited = null;
        },
        onError() {
          if (onCreated) terminalManager.globalEvents.off("created", onCreated);
          if (onExited) terminalManager.globalEvents.off("exited", onExited);
        },
      };
    })
  );

  return { restRoute, wsRoute };
}
