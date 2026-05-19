import React from 'react';
import { createPortal } from 'react-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { WindowControls } from '../components/WindowControls';
import { SettingsContent } from './SettingsContent';

const titlebarEl = document.querySelector('.titlebar');

export function SettingsApp() {
  return (
    <ErrorBoundary region="settings">
      <SettingsContent variant="window" listenToWindowTabSwitch />

      {/* Windows/Linux 窗口控制按钮，渲染到 settings.html 的 .titlebar 容器 */}
      {titlebarEl && createPortal(<WindowControls />, titlebarEl)}
    </ErrorBoundary>
  );
}
