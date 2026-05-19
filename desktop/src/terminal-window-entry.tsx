/**
 * terminal-window-entry.tsx — 终端窗口入口
 *
 * 加载方式：Electron main 通过 createTerminalWindow 打开，URL 携带 ?cwd=... 作为初始 tab 的工作目录。
 */
import { createRoot } from 'react-dom/client';
import { TerminalApp } from './react/terminal/TerminalApp';

const el = document.getElementById('react-root');
if (el) {
  createRoot(el).render(<TerminalApp />);
}
