/**
 * TerminalSessionCard — 对话流中内嵌的终端会话只读预览卡片
 *
 * 触发：当一个 tool_group 里出现 `terminal_create` 且成功时，渲染在该工具下方。
 *
 * 行为：
 *  - 通过 WS 订阅 /api/terminal/:id/stream（同一会话所有客户端共享 PTY 输出）
 *  - 累积一个 ~12KB 的滚动缓冲（按行），ANSI 控制序列剥除，只展示最近若干行
 *  - 状态条：运行中 / 已结束(exitCode)
 *  - 右上角"打断"按钮 → POST /api/terminal/:id/interrupt-by-human，向 PTY 发 Ctrl+C
 *    并在 session.humanInterrupts 里记一条标记，让 AI 的 terminal_read / terminal_wait 知道
 *    是用户而不是程序自己 Ctrl+C，避免 AI 默默重跑。
 *
 * 注意：本卡片不允许人类与 AI 共享 PTY 输入。终端属于 AI，人类只有「观察 + 打断」两种权限。
 */
import { memo, useEffect, useRef, useState } from 'react';
import styles from './Chat.module.css';

// eslint-disable-next-line no-control-regex -- 正是要匹配 ANSI 控制字符来剥掉颜色序列
const ANSI_CURSOR_LINE_START = /\x1b\[(?:\d+;)?1H/g;
const ANSI_STRIP = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[=>]/g;
const MAX_BUFFER_CHARS = 16 * 1024;

interface Props {
  termId: string;
  /** 可选的标题/cwd 提示（从 tool.details 来） */
  title?: string;
  cwd?: string;
  /**
   * 本轮 terminal_wait / terminal_read 工具结果中已捕获的输出切片。
   * 有值时：静态渲染这段文本（"这一轮命令产生的输出"），不再订阅 PTY 实时尾部。
   * 这样同一会话跨多轮的多张卡片各自显示那一轮的真实快照，不会全都看起来重复。
   */
  staticOutput?: string;
  /** 与 staticOutput 配套的活跃状态（来自 details.alive） */
  staticAlive?: boolean;
  /** 与 staticOutput 配套的退出码 */
  staticExitCode?: number | null;
  /** server 端已切掉了开头 / 输出太长被截断时为 true */
  outputTruncated?: boolean;
  /**
   * 本组工具调用涉及的整体 cursor 范围。如果两个都给了，卡片会优先向 server
   * 拉 [sliceFrom, sliceTo) 的完整切片渲染，避免只看到最后一次 wait 的局部输出。
   * 拉失败（比如 ring buffer 过期 / session 已销毁）时回退到 staticOutput。
   */
  sliceFrom?: number;
  sliceTo?: number;
}

interface StreamMessage {
  type?: string;
  // snapshot 用 output，data 用 data —— 服务端两种 key 都要兼容
  output?: string;
  data?: string;
  encoding?: string;
  cursor?: number;
  alive?: boolean;
  // exit 事件
  exitCode?: number | null;
  code?: number | null;
  signal?: string | null;
}

function stripTerminalAnsi(s: string): string {
  return s.replace(ANSI_CURSOR_LINE_START, '\n').replace(ANSI_STRIP, '');
}

export function normalizeTerminalOutput(s: string): string {
  return stripTerminalAnsi(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeTerminalOutputChunk(s: string, previousEndedWithCarriageReturn: boolean): { text: string; endsWithCarriageReturn: boolean } {
  let clean = stripTerminalAnsi(s);
  if (previousEndedWithCarriageReturn && clean.startsWith('\n')) clean = clean.slice(1);
  return {
    text: clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    endsWithCarriageReturn: clean.endsWith('\r'),
  };
}

export const TerminalSessionCard = memo(function TerminalSessionCard({
  termId,
  title,
  cwd,
  staticOutput,
  staticAlive,
  staticExitCode,
  outputTruncated,
  sliceFrom,
  sliceTo,
}: Props) {
  // 渲染优先级（高→低）：
  //   1. live buf      —— WS 订阅 PTY 当前尾部（live 模式 WS 一通就走这条）
  //   2. fetchedSlice  —— WS 报告 session not found 后，再 fallback 去 HTTP 拉 [sliceFrom, sliceTo)
  //   3. staticOutput  —— 单次工具调用 details.output 里的快照（最后兜底）
  const wantsSlice =
    Number.isFinite(sliceFrom) && Number.isFinite(sliceTo) && (sliceTo as number) > (sliceFrom as number);
  const hasStatic = typeof staticOutput === 'string';
  const [fetchedSlice, setFetchedSlice] = useState<{ text: string; truncatedStart: boolean } | null>(null);
  const [buf, setBuf] = useState('');
  const [alive, setAlive] = useState(hasStatic && staticAlive === false ? false : true);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(
    hasStatic && staticAlive === false ? { code: staticExitCode ?? null, signal: null } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bufRef = useRef('');
  const trailingCrRef = useRef(false);

  // 仅在 WS 确认会话已不在（history 模式）时，才尝试 HTTP 拉 slice；live 模式不能拉，
  // 否则会用过早 cursor 区间冻结视图、看不到后续输出。
  useEffect(() => {
    if (!wantsSlice) return;
    if (error !== 'history-no-output') return;
    let cancelled = false;
    (async () => {
      try {
        const port = String((await window.platform?.getServerPort?.()) ?? '');
        const token = String((await window.platform?.getServerToken?.()) ?? '');
        if (!port || !token) return;
        const url = `http://127.0.0.1:${port}/api/terminal/${encodeURIComponent(termId)}/slice?from=${sliceFrom}&to=${sliceTo}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data: { ok?: boolean; text?: string; truncatedStart?: boolean } = await res.json();
        if (cancelled) return;
        if (data?.ok && typeof data.text === 'string') {
          setFetchedSlice({ text: normalizeTerminalOutput(data.text), truncatedStart: !!data.truncatedStart });
        }
      } catch { /* slice 拉失败：渲染会自动回退到 staticOutput */ }
    })();
    return () => { cancelled = true; };
  }, [termId, wantsSlice, sliceFrom, sliceTo, error]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    async function connect() {
      let port = '';
      let token = '';
      try {
        port = String((await window.platform?.getServerPort?.()) ?? '');
        token = String((await window.platform?.getServerToken?.()) ?? '');
      } catch {
        if (!cancelled) setError('无法获取 server 信息');
        return;
      }
      if (cancelled || !port || !token) return;

      const url = `ws://127.0.0.1:${port}/api/terminal/${encodeURIComponent(termId)}/stream?token=${encodeURIComponent(token)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'WS 创建失败');
        return;
      }
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let msg: StreamMessage;
        try { msg = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }
        if (!msg) return;
        if (msg.type === 'error') {
          // server 明确告诉我们这个 session 已经不在了（一般是 server 重启后回放历史）
          // 把状态打成"已结束 + 历史模式"，避免卡片永远显示"运行中"+"(暂无输出…)"。
          if (!cancelled) {
            setAlive(false);
            setError('history-no-output');
          }
          return;
        }
        if (msg.type === 'snapshot' || msg.type === 'data') {
          // server: snapshot.output / data.data —— 两个 key 都收
          const raw = typeof msg.output === 'string'
            ? msg.output
            : (typeof msg.data === 'string' ? msg.data : '');
          const normalized = normalizeTerminalOutputChunk(raw, trailingCrRef.current);
          const clean = normalized.text;
          trailingCrRef.current = normalized.endsWithCarriageReturn;
          // snapshot 即使为空也要照搬 alive 状态
          if (msg.type === 'snapshot' && typeof msg.alive === 'boolean') {
            setAlive(msg.alive);
          }
          if (!clean) return;
          // snapshot 是 PTY ring buffer 的完整尾部 → 整段替换 bufRef，
          // 不和之前累积的 data 拼接（避免重复）
          let next: string;
          if (msg.type === 'snapshot') {
            next = clean;
          } else {
            next = bufRef.current + clean;
          }
          if (next.length > MAX_BUFFER_CHARS) next = next.slice(next.length - MAX_BUFFER_CHARS);
          bufRef.current = next;
          setBuf(next);
        } else if (msg.type === 'exit') {
          setAlive(false);
          setExitInfo({ code: msg.exitCode ?? msg.code ?? null, signal: msg.signal ?? null });
        }
      };
      ws.onerror = () => {
        if (!cancelled) setError('WebSocket 错误');
      };
      ws.onclose = () => {
        // 退出事件优先；若没收到 exit 但 ws 主动断了（如 server 重启），稍等再试
        if (cancelled) return;
        if (alive) {
          retryTimer = window.setTimeout(() => { if (!cancelled) connect(); }, 1500);
        }
      };
    }

    void connect();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
    // termId 是 stable 的；alive 仅用于重连判断，不应作为 dep（避免每次切换都重连）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  const [interrupting, setInterrupting] = useState(false);
  const [interruptHint, setInterruptHint] = useState<string | null>(null);
  const handleInterrupt = async () => {
    if (interrupting || !alive) return;
    setInterrupting(true);
    setInterruptHint(null);
    try {
      const port = String((await window.platform?.getServerPort?.()) ?? '');
      const token = String((await window.platform?.getServerToken?.()) ?? '');
      if (!port || !token) {
        setInterruptHint('无法获取 server 连接信息');
        return;
      }
      const res = await fetch(
        `http://127.0.0.1:${port}/api/terminal/${encodeURIComponent(termId)}/interrupt-by-human`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        setInterruptHint(`打断失败 (HTTP ${res.status})`);
        return;
      }
      setInterruptHint('已发送 Ctrl+C');
      window.setTimeout(() => setInterruptHint(null), 2000);
    } catch (err) {
      setInterruptHint(err instanceof Error ? err.message : '打断失败');
    } finally {
      setInterrupting(false);
    }
  };

  // 渲染源选择：fetchedSlice > staticOutput > live buf
  let sourceText = '';
  let sourceTruncated = false;
  if (fetchedSlice) {
    sourceText = fetchedSlice.text;
    sourceTruncated = fetchedSlice.truncatedStart;
  } else if (buf) {
    // WS live：只要拿到了任何字节就用它（最新、最实时）
    sourceText = buf;
  } else if (hasStatic) {
    // WS 还没起 / 已被识别为"会话已死"，用静态快照兜底
    sourceText = normalizeTerminalOutput(staticOutput || '');
    sourceTruncated = !!outputTruncated;
  } else {
    sourceText = '';
  }
  // 整段渲染，不做行数裁剪。卡片 CSS 有 max-height + overflow-y:auto，
  // 超出自动滚动，不会撑爆布局。
  const preview = sourceText.replace(/\n+$/, '');

  // 尾随自动滚动：每次有新输出且会话仍在跑就把视窗滚到底，让用户始终看到最新内容。
  // 用户主动滚到非底部时把 stickRef 关掉，避免抢用户翻历史输出的鼠标。
  const bodyRef = useRef<HTMLPreElement | null>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
      stickRef.current = atBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [preview]);
  const displayTitle = title || (cwd ? cwd.split(/[\\/]/).pop() || cwd : `终端 ${termId.slice(0, 6)}`);

  return (
    <div className={styles.terminalCard}>
      <div className={styles.terminalCardHeader}>
        <div className={styles.terminalCardTitleRow}>
          <span className={styles.terminalCardIcon} aria-hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </span>
          <span className={styles.terminalCardTitle} title={cwd || displayTitle}>{displayTitle}</span>
          <span className={`${styles.terminalCardStatus} ${alive ? styles.terminalCardStatusAlive : styles.terminalCardStatusDead}`}>
            {alive ? '运行中' : exitInfo ? `已退出 (${exitInfo.code ?? '?'}${exitInfo.signal ? ` ${exitInfo.signal}` : ''})` : '已结束'}
          </span>
        </div>
        {alive && (
          <button
            className={styles.terminalCardJump}
            onClick={handleInterrupt}
            disabled={interrupting}
            title={interruptHint || '向 AI 终端发送 Ctrl+C 打断当前命令'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        )}
      </div>
      <pre className={styles.terminalCardBody} ref={bodyRef}>
        {error === 'history-no-output' && !preview
          ? <span className={styles.terminalCardEmpty}>(终端会话已结束，本次输出未持久化保存)</span>
          : error && error !== 'history-no-output'
            ? <span className={styles.terminalCardError}>{error}</span>
            : preview
              ? (
                <>
                  {sourceTruncated && (
                    <span className={styles.terminalCardEmpty}>{'… (开头已截断)\n'}</span>
                  )}
                  {preview}
                </>
              )
              : <span className={styles.terminalCardEmpty}>(暂无输出…)</span>}
      </pre>
    </div>
  );
});
