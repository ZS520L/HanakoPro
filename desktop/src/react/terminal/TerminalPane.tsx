/**
 * TerminalPane — 单个终端面板（xterm.js + WebSocket）
 *
 * Props:
 *   termId       服务端 PTY id
 *   serverPort   server 端口
 *   serverToken  鉴权 token
 *   onExit       PTY 退出回调
 *
 * 流程：
 *   1. mount 时打开 xterm 实例 + 连接 WS
 *   2. 收到 snapshot 写入屏幕（补回离线期间的输出）
 *   3. 用户输入 → ws.send {type:input}
 *   4. xterm resize → ws.send {type:resize}
 *   5. unmount 时关闭 ws + dispose xterm
 *
 * 注意：ws 关闭不等于 PTY 退出。仅当收到 type:"exit" 才标记 dead。
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import s from './TerminalApp.module.css';

interface Props {
  termId: string;
  serverPort: string;
  serverToken: string;
  onExit?: () => void;
}

const THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

export function TerminalPane({ termId, serverPort, serverToken, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // onExit 走 ref，避免父组件每次 re-render 产生的新闭包让 useEffect 重跑导致
  // xterm 销毁重建（历史 / scrollback 会全丢）。
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── xterm 实例 ──
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    // 只在容器真正有尺寸时才 fit / 发 resize。
    // 初次挂载时 tab 可能处在 display:none 状态（offsetWidth=0），
    // 此时 fit.fit() 会算出 cols=0 / rows=0，发到 server 后 conpty 会 reflow
    // 整个屏幕、把 ring buffer 里历史输出冲掉 —— 表现就是后来切到这个 tab 内容全没了。
    const containerHasSize = () => container.offsetWidth > 0 && container.offsetHeight > 0;
    let lastSentCols = -1;
    let lastSentRows = -1;
    const trySyncSize = () => {
      if (!containerHasSize()) return;
      try { fit.fit(); } catch { return; }
      const cols = term.cols;
      const rows = term.rows;
      if (!cols || !rows) return;
      if (cols === lastSentCols && rows === lastSentRows) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
          lastSentCols = cols;
          lastSentRows = rows;
        } catch {}
      }
    };

    // ── WebSocket ──
    const wsUrl = `ws://127.0.0.1:${serverPort}/api/terminal/${termId}/stream?token=${encodeURIComponent(serverToken)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      // 只在容器可见时同步尺寸；不可见时等 ResizeObserver 后续触发
      trySyncSize();
    };

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }
      if (!msg) return;
      if (msg.type === 'snapshot') {
        // 清屏后重写历史输出
        term.reset();
        if (typeof msg.output === 'string') term.write(msg.output);
      } else if (msg.type === 'data' && typeof msg.data === 'string') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        const code = msg.exitCode != null ? msg.exitCode : '?';
        const sig = msg.signal ? ` (signal=${msg.signal})` : '';
        term.write(`\r\n\x1b[33m[Process exited code=${code}${sig}]\x1b[0m\r\n`);
        onExitRef.current?.();
      } else if (msg.type === 'error' && msg.error) {
        term.write(`\r\n\x1b[31m[终端错误: ${msg.error}]\x1b[0m\r\n`);
      }
    };

    ws.onerror = () => {
      if (!opened) {
        term.write('\r\n\x1b[31m[无法连接到 PTY 流]\x1b[0m\r\n');
      }
    };

    ws.onclose = () => {
      // 不调 onExit；连接关不等于进程退出。
    };

    // ── 用户输入 → WS ──
    const inputDisp = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // ── 容器尺寸变化 → fit + 通知 server ──
    // 走 trySyncSize：0×0 时不发 resize，避免后台 tab 的 conpty 把 ring buffer 冲掉
    const ro = new ResizeObserver(() => { trySyncSize(); });
    ro.observe(container);
    // display:none → display:block 不一定立刻触发 ResizeObserver；下一帧主动同步一次
    requestAnimationFrame(() => { trySyncSize(); });

    // ── cleanup ──
    return () => {
      ro.disconnect();
      inputDisp.dispose();
      try { ws.close(); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
    // 故意不把 onExit 放进 deps，由 onExitRef 转发最新值。
    // 这样切 tab 引起的父组件 re-render 不会重建 xterm，scrollback 得以保留。
  }, [termId, serverPort, serverToken]);

  return <div ref={containerRef} className={s.xtermContainer} />;
}
