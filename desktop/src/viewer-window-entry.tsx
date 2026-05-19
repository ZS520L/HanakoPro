/**
 * viewer-window-entry.tsx — 派生 Viewer 窗口的 React 入口
 *
 * 语义：
 * - 派生出的只读副本窗口，展示主面板某个 tab 对应的本地文件
 * - Live 只读：viewer 自己 watchFile，文件外部变化时重新 readFile 并刷新
 * - 与主面板 preview **不通信**（不 dock、不回写、不共享 zustand store）
 * - 仅支持可编辑文本类型（markdown / code / csv），其他类型的 tab 在主面板不提供「在新窗口查看」入口
 *
 * 生命周期：
 *   主进程 spawn BrowserWindow → did-finish-load → IPC `viewer-load` 送文件元信息
 *   → readFile → 渲染 PreviewEditor(readOnly) → watchFile → 变化时 readFile + setContent
 *   → 窗口 close → 主进程广播 `viewer-closed` 给主 renderer 清 store
 */

import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { PreviewEditor } from './react/components/PreviewEditor';

type ViewerMode = 'markdown' | 'code' | 'csv';

interface ViewerLoadPayload {
  filePath: string;
  title: string;
  type: string;
  language?: string | null;
  windowId: number;
}

function typeToMode(type: string): ViewerMode {
  if (type === 'markdown') return 'markdown';
  if (type === 'csv') return 'csv';
  return 'code';
}

// Subset of the renderer-side `window.platform` we use in the viewer.
interface ViewerPlatform {
  readFile(path: string): Promise<string | null>;
  watchFile(path: string): Promise<boolean>;
  unwatchFile(path: string): Promise<boolean>;
  onFileChanged(callback: (path: string) => void): void;
  onViewerLoad?(callback: (data: ViewerLoadPayload) => void): void;
  viewerClose?(): void;
}

function getPlatform(): ViewerPlatform | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window.platform is injected by preload
  return (window as any).platform ?? null;
}

function ViewerApp() {
  const [payload, setPayload] = useState<ViewerLoadPayload | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1. 等 IPC 送来文件元信息
  useEffect(() => {
    const platform = getPlatform();
    if (!platform?.onViewerLoad) return;
    platform.onViewerLoad((data) => {
      setPayload(data);
      setLoadError(null);
      document.title = data.title || 'Viewer';
    });
  }, []);

  // 2. 初始读取 + 挂 file watch
  useEffect(() => {
    if (!payload?.filePath) return;
    const platform = getPlatform();
    if (!platform) return;

    let cancelled = false;

    const fail = (err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[viewer] live file load failed:', err);
      setLoadError(message);
    };

    // 初始内容
    platform.readFile(payload.filePath)
      .then((c) => {
        if (cancelled) return;
        setLoadError(null);
        setContent(c ?? '');
      })
      .catch(fail);

    // Live watch
    platform.watchFile(payload.filePath);
    platform.onFileChanged((changedPath) => {
      if (cancelled) return;
      if (changedPath !== payload.filePath) return;
      platform.readFile(payload.filePath)
        .then((c) => {
          if (cancelled) return;
          if (c == null) return;
          setLoadError(null);
          setContent(c);
        })
        .catch(fail);
    });

    return () => {
      cancelled = true;
      platform.unwatchFile(payload.filePath);
    };
  }, [payload?.filePath]);

  const handleClose = () => getPlatform()?.viewerClose?.();

  if (!payload) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
        Failed to load file: {loadError}
      </div>
    );
  }

  const mode = typeToMode(payload.type);

  return (
    <>
      <div className="viewer-toolbar">
        <div className="viewer-title">{payload.title}</div>
        <button className="viewer-close-btn" onClick={handleClose} title="Close">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="viewer-body">
        {content != null && (
          <PreviewEditor
            content={content}
            filePath={payload.filePath}
            mode={mode}
            language={payload.language}
            readOnly
          />
        )}
      </div>
      <div className="viewer-readonly-badge">只读 · live</div>
    </>
  );
}

// Mount
const rootEl = document.getElementById('react-root');
if (rootEl) {
  createRoot(rootEl).render(<ViewerApp />);
}
