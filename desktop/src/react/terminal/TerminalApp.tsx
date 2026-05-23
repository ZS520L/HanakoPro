/**
 * TerminalApp — 终端窗口主组件
 *
 * 负责：
 *   - 多 tab 管理（创建 / 切换 / 关闭）
 *   - 每个 tab 持有独立 TerminalPane（xterm.js 实例 + WS 连接）
 *   - 顶部 tab 栏 + " + 新建" 按钮
 *
 * 与 server 通信：
 *   - HTTP POST /api/terminal/create 创建会话
 *   - WS /api/terminal/:id/stream 双向 IO
 *
 * Server 信息从 preload 注入的 window.platform.getServerPort/Token 取。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalPane } from './TerminalPane';
import s from './TerminalApp.module.css';

interface TabInfo {
  /** server 端 PTY id；create 中可能为 null（创建中） */
  id: string | null;
  /** 客户端临时 key（用于 React diff，server id 拿到前用） */
  key: string;
  title: string;
  cwd: string;
  alive: boolean;
  /** 创建期间的错误 */
  error?: string;
}

let _seq = 0;
function nextKey() { return `t-${++_seq}-${Date.now().toString(36)}`; }

function getInitialCwd(): string {
  try {
    const params = new URLSearchParams(location.search);
    return params.get('cwd') || '';
  } catch { return ''; }
}

export function TerminalApp() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<{ port: string; token: string } | null>(null);
  const initRef = useRef(false);
  const eventsWsRef = useRef<WebSocket | null>(null);

  /** 从 server 推送的会话 meta 合并 / 新增 tab（幂等，依 id） */
  const adoptServerSession = useCallback((meta: {
    id: string; title?: string; cwd?: string; alive?: boolean;
  }) => {
    if (!meta?.id) return;
    setTabs(prev => {
      // 兜底去重：如果由于早先的 race 已经出现了多条同 id 的 tab，这里收敛成一条。
      const sameId = prev.filter(t => t.id === meta.id);
      if (sameId.length > 0) {
        const keep = sameId[0];
        return prev
          .filter(t => t.id !== meta.id || t.key === keep.key)
          .map(t => t.key === keep.key
            ? { ...t, alive: meta.alive ?? t.alive, title: meta.title || t.title, cwd: meta.cwd || t.cwd }
            : t);
      }
      const cwd = meta.cwd || '';
      const title = meta.title || (cwd ? cwd.split(/[\\/]/).pop() || cwd : `Terminal ${meta.id.slice(0, 6)}`);
      const newTab: TabInfo = {
        id: meta.id,
        key: nextKey(),
        title,
        cwd,
        alive: meta.alive ?? true,
      };
      return [...prev, newTab];
    });
  }, []);

  const createTab = useCallback(async (cwd: string, info?: { port: string; token: string }) => {
    const ctx = info ?? serverInfo;
    if (!ctx) return;
    const key = nextKey();
    const tabTitle = cwd ? cwd.split(/[\\/]/).pop() || cwd : 'Terminal';
    const tab: TabInfo = { id: null, key, title: tabTitle, cwd, alive: true };
    setTabs(prev => [...prev, tab]);
    setActiveKey(key);

    try {
      const res = await fetch(`http://127.0.0.1:${ctx.port}/api/terminal/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ctx.token}`,
        },
        body: JSON.stringify({ cwd, cols: 100, rows: 30 }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'create failed');
      setTabs(prev => {
        // events WS 可能已经先一步把这个 id 当作"新会话"加进来了 —— 此时直接丢掉本地占位 tab，
        // 避免出现两条同 id 的标签页。
        const adoptedAlready = prev.some(t => t.id === data.id && t.key !== key);
        if (adoptedAlready) {
          // 把 activeKey 切到 events WS 加进来的那个 tab，再删除占位
          const adopted = prev.find(t => t.id === data.id && t.key !== key);
          if (adopted) setActiveKey(adopted.key);
          return prev.filter(t => t.key !== key);
        }
        return prev.map(t => t.key === key
          ? { ...t, id: data.id, title: data.title || tabTitle, cwd: data.cwd, alive: data.alive }
          : t);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTabs(prev => prev.map(t => t.key === key ? { ...t, alive: false, error: msg } : t));
    }
  }, [serverInfo]);

  // 初始化：拿 server port/token → 拉现有 PTY 列表 → 订阅全局事件 → 需要时才新建第一个 tab
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cancelled = false;
    (async () => {
      let port = '';
      let token = '';
      try {
        port = String(await window.platform?.getServerPort?.() ?? '');
        token = String(await window.platform?.getServerToken?.() ?? '');
      } catch (err) {
        console.error('[terminal] 获取 server 信息失败', err);
      }
      if (cancelled) return;
      setServerInfo({ port, token });

      // 1) 拉现存 PTY 列表，适配为 tab（这里能看到 AI 在后台建的会话）
      let existingCount = 0;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/terminal/list`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        const items = Array.isArray(data?.terminals) ? data.terminals : [];
        existingCount = items.length;
        for (const item of items) adoptServerSession(item);
        if (items.length > 0) {
          // 默认选中最后一个活着的（常是 AI 刚创建的）
          const last = items.slice().reverse().find((x: { alive?: boolean }) => x.alive) ?? items[items.length - 1];
          if (last) {
            // 默认 activeKey 会被后续从 tabs[] 推出；这里不接取 key，交给 React 状态同步后补上
            setTimeout(() => {
              setTabs(curr => {
                const match = curr.find(t => t.id === last.id);
                if (match) setActiveKey(match.key);
                return curr;
              });
            }, 0);
          }
        }
      } catch (err) {
        console.warn('[terminal] 加载现有会话列表失败', err);
      }

      // 2) 订阅全局事件（AI 后续创建 / 退出会同步过来）
      try {
        const wsUrl = `ws://127.0.0.1:${port}/api/terminal/events?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);
        eventsWsRef.current = ws;
        ws.onmessage = (event) => {
          let msg: { type?: string; terminal?: { id: string; title?: string; cwd?: string; alive?: boolean }; terminals?: { id: string; title?: string; cwd?: string; alive?: boolean }[]; id?: string };
          try { msg = JSON.parse(typeof event.data === 'string' ? event.data : ''); } catch { return; }
          if (!msg) return;
          if (msg.type === 'snapshot' && Array.isArray(msg.terminals)) {
            for (const item of msg.terminals) adoptServerSession(item);
          } else if (msg.type === 'created' && msg.terminal) {
            adoptServerSession(msg.terminal);
          } else if (msg.type === 'exited' && typeof msg.id === 'string') {
            const exitedId = msg.id;
            setTabs(prev => prev.map(t => t.id === exitedId ? { ...t, alive: false } : t));
          }
        };
      } catch (err) {
        console.warn('[terminal] 事件订阅失败', err);
      }

      // 3) 如果 server 那边完全没有 PTY，才自动开第一个（避免项目中途打开窗口又多出一个空 tab）
      if (existingCount === 0) {
        void createTab(getInitialCwd(), { port, token });
      }
    })();
    return () => {
      cancelled = true;
      try { eventsWsRef.current?.close(); } catch {}
      eventsWsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主窗口再次点击“打开终端”按钮时，主进程发 IPC 让我们新开一个 tab
  useEffect(() => {
    const platform = (window as unknown as { platform?: { onTerminalNewTab?: (cb: (data: { cwd?: string }) => void) => (() => void) | void } }).platform;
    if (!platform?.onTerminalNewTab) return;
    const off = platform.onTerminalNewTab((data) => {
      void createTab((data?.cwd || '').trim());
    });
    return () => { if (typeof off === 'function') off(); };
  }, [createTab]);

  // 对话内卡片右上角的"跳转"按钮 → 主进程发 terminal-focus-tab，让我们切到指定 tab
  useEffect(() => {
    const platform = (window as unknown as { platform?: { onTerminalFocusTab?: (cb: (data: { id: string }) => void) => (() => void) | void } }).platform;
    if (!platform?.onTerminalFocusTab) return;
    const off = platform.onTerminalFocusTab((data) => {
      const targetId = data?.id;
      if (!targetId) return;
      setTabs(curr => {
        const match = curr.find(t => t.id === targetId);
        if (match) setActiveKey(match.key);
        return curr;
      });
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  const closeTab = useCallback(async (key: string) => {
    const tab = tabs.find(t => t.key === key);
    if (tab?.id && serverInfo) {
      try {
        await fetch(`http://127.0.0.1:${serverInfo.port}/api/terminal/${tab.id}/kill`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serverInfo.token}` },
        });
      } catch {}
    }
    setTabs(prev => {
      const idx = prev.findIndex(t => t.key === key);
      const next = prev.filter(t => t.key !== key);
      if (activeKey === key) {
        const newActive = next[idx] || next[idx - 1] || next[0] || null;
        setActiveKey(newActive ? newActive.key : null);
      }
      return next;
    });
  }, [tabs, serverInfo, activeKey]);

  const onTabExit = useCallback((key: string) => {
    setTabs(prev => prev.map(t => t.key === key ? { ...t, alive: false } : t));
  }, []);

  // 渲染时按 id 去重 —— 即便上游某条路径漏过去重逻辑，UI 也保证一个 server session 只显示一个 tab。
  // id=null 的占位 tab（createTab 期间）仍然原样保留（多个并行创建用各自的 key 区分，不会互相覆盖）。
  const visibleTabs: TabInfo[] = (() => {
    const seenIds = new Set<string>();
    const out: TabInfo[] = [];
    for (const t of tabs) {
      if (t.id) {
        if (seenIds.has(t.id)) continue;
        seenIds.add(t.id);
      }
      out.push(t);
    }
    return out;
  })();

  return (
    <div className={s.app}>
      <div className={s.tabbar}>
        <div className={s.tabs}>
          {visibleTabs.map(t => (
            <div
              key={t.key}
              className={`${s.tab}${activeKey === t.key ? ` ${s.tabActive}` : ''}${!t.alive ? ` ${s.tabDead}` : ''}`}
              onClick={() => setActiveKey(t.key)}
              title={t.cwd || ''}
            >
              <span className={s.tabTitle}>{t.title}{!t.alive ? ' (已结束)' : ''}</span>
              <button
                className={s.tabClose}
                onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}
                title="关闭"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className={s.windowControls}>
          <button
            className={s.iconBtn}
            onClick={() => createTab(getInitialCwd())}
            title="新建终端"
            disabled={!serverInfo}
          >
            +
          </button>
          <button
            className={s.iconBtn}
            onClick={() => window.platform?.windowMinimize?.()}
            title="最小化终端窗口"
          >
            −
          </button>
          <button
            className={`${s.iconBtn} ${s.closeBtn}`}
            onClick={() => window.platform?.windowClose?.()}
            title="关闭终端窗口"
          >
            ×
          </button>
        </div>
      </div>
      <div className={s.body}>
        {visibleTabs.map(t => (
          <div
            key={t.key}
            className={s.pane}
            style={{ display: activeKey === t.key ? 'block' : 'none' }}
          >
            {t.error ? (
              <div className={s.error}>创建失败：{t.error}</div>
            ) : t.id && serverInfo ? (
              <TerminalPane
                termId={t.id}
                serverPort={serverInfo.port}
                serverToken={serverInfo.token}
                onExit={() => onTabExit(t.key)}
              />
            ) : (
              <div className={s.loading}>正在创建终端...</div>
            )}
          </div>
        ))}
        {tabs.length === 0 && (
          <div className={s.empty}>没有打开的终端。点击 + 新建一个。</div>
        )}
      </div>
    </div>
  );
}
