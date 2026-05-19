/**
 * useSidebarResize — 侧边栏宽度拖拽调整
 *
 * 从 sidebar-shim.ts 的 initSidebarResize 迁移。
 * 在 useEffect 中绑定 resize handle 事件，并在 unmount 时完整清理。
 */

import { useEffect } from 'react';
import { useStore } from '../stores';

export function useSidebarResize(): void {
  const currentTab = useStore(s => s.currentTab);
  const currentChannel = useStore(s => s.currentChannel);
  const previewOpen = useStore(s => s.previewOpen);

  useEffect(() => {
    const root = document.documentElement;
    const sidebarEl = document.getElementById('sidebar');
    const jianSidebarEl = document.getElementById('jianSidebar');
    const channelInspectorEl = document.getElementById('channelInspector');
    const leftHandle = document.getElementById('sidebarResizeHandle');
    const rightHandle = document.getElementById('jianResizeHandle');
    const channelInspectorHandle = document.getElementById('channelInspectorResizeHandle');
    const previewPanel = document.getElementById('previewPanel');

    const LEFT_MIN = 180, LEFT_MAX = 400;
    const RIGHT_MIN = 200, RIGHT_MAX = 600;
    const CHANNEL_INSPECTOR_MIN = 220, CHANNEL_INSPECTOR_MAX = 620;
    const PREVIEW_MIN = 320, PREVIEW_MAX = 800;

    const leftInner = sidebarEl?.querySelector('.sidebar-inner') as HTMLElement | null;
    const rightInner = jianSidebarEl?.querySelector('.jian-sidebar-inner') as HTMLElement | null;
    const previewInner = previewPanel?.querySelector('.preview-panel-inner') as HTMLElement | null;

    function applySidebarWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--sidebar-width', px);
      if (leftInner) { leftInner.style.width = px; leftInner.style.minWidth = px; }
    }

    function updateJianColumns(w: number): void {
      const cols = w > 520 ? 3 : w > 350 ? 2 : 1;
      root.style.setProperty('--jian-columns', String(cols));
    }

    function applyJianWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--jian-sidebar-width', px);
      if (rightInner) { rightInner.style.width = px; rightInner.style.minWidth = px; }
      updateJianColumns(w);
    }

    function applyChannelInspectorWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--channel-inspector-width', px);
      if (channelInspectorEl) {
        channelInspectorEl.style.width = px;
        channelInspectorEl.style.minWidth = px;
      }
    }

    function applyPreviewWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--preview-panel-width', px);
      if (previewInner) { previewInner.style.width = px; previewInner.style.minWidth = px; }
    }

    // 恢复保存的宽度
    const savedLeft = localStorage.getItem('hana-sidebar-width');
    const savedRight = localStorage.getItem('hana-jian-width');
    const savedChannelInspector = localStorage.getItem('hana-channel-inspector-width');
    const savedPreview = localStorage.getItem('hana-preview-width');
    if (savedLeft) applySidebarWidth(Number(savedLeft));
    if (savedRight) applyJianWidth(Number(savedRight));
    if (savedChannelInspector) applyChannelInspectorWidth(Number(savedChannelInspector));
    if (savedPreview) applyPreviewWidth(Number(savedPreview));

    const cleanupFns: Array<() => void> = [];

    function setupHandle(
      handle: HTMLElement | null,
      getSidebar: () => HTMLElement | null,
      getWidth: () => number,
      setWidth: (w: number) => void,
      min: number,
      max: number,
      storageKey: string,
      isRight: boolean,
    ): void {
      if (!handle) return;

      const onHandleMove = (e: MouseEvent) => {
        const rect = handle.getBoundingClientRect();
        handle.style.setProperty('--handle-y', (e.clientY - rect.top) + 'px');
      };
      const onHandleLeave = () => {
        handle.style.setProperty('--handle-y', '-999px');
      };

      let activeDragCleanup: (() => void) | null = null;

      const onMouseDown = (e: MouseEvent) => {
        activeDragCleanup?.();
        activeDragCleanup = null;

        e.preventDefault();
        const sidebarTarget = getSidebar();
        if (!sidebarTarget || sidebarTarget.classList.contains('collapsed')) return;

        const startX = e.clientX;
        const startW = getWidth();
        let liveWidth = startW;
        handle.classList.add('active');
        document.body.classList.add('resizing');

        function onMove(e: MouseEvent): void {
          const delta = isRight ? startX - e.clientX : e.clientX - startX;
          const w = Math.max(min, Math.min(max, startW + delta));
          liveWidth = w;
          setWidth(w);
          const rect = handle!.getBoundingClientRect();
          handle!.style.setProperty('--handle-y', (e.clientY - rect.top) + 'px');
        }

        function onUp(): void {
          handle!.classList.remove('active');
          document.body.classList.remove('resizing');
          handle!.style.setProperty('--handle-y', '-999px');
          const w = liveWidth;
          localStorage.setItem(storageKey, String(w));
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          activeDragCleanup = null;
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        activeDragCleanup = () => {
          handle.classList.remove('active');
          document.body.classList.remove('resizing');
          handle.style.setProperty('--handle-y', '-999px');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          activeDragCleanup = null;
        };
      };

      handle.addEventListener('mousemove', onHandleMove);
      handle.addEventListener('mouseleave', onHandleLeave);
      handle.addEventListener('mousedown', onMouseDown);

      cleanupFns.push(() => {
        activeDragCleanup?.();
        handle.removeEventListener('mousemove', onHandleMove);
        handle.removeEventListener('mouseleave', onHandleLeave);
        handle.removeEventListener('mousedown', onMouseDown);
      });
    }

    setupHandle(
      leftHandle,
      () => sidebarEl,
      () => sidebarEl?.offsetWidth || 240,
      (w) => applySidebarWidth(w),
      LEFT_MIN, LEFT_MAX, 'hana-sidebar-width', false,
    );

    setupHandle(
      rightHandle,
      () => jianSidebarEl,
      () => jianSidebarEl?.offsetWidth || 260,
      (w) => applyJianWidth(w),
      RIGHT_MIN, RIGHT_MAX, 'hana-jian-width', true,
    );

    setupHandle(
      channelInspectorHandle,
      () => channelInspectorEl,
      () => channelInspectorEl?.offsetWidth || 280,
      (w) => applyChannelInspectorWidth(w),
      CHANNEL_INSPECTOR_MIN, CHANNEL_INSPECTOR_MAX, 'hana-channel-inspector-width', true,
    );

    const previewHandle = document.getElementById('previewResizeHandle');
    setupHandle(
      previewHandle,
      () => previewPanel,
      () => previewPanel?.offsetWidth || 580,
      (w) => applyPreviewWidth(w),
      PREVIEW_MIN, PREVIEW_MAX, 'hana-preview-width', true,
    );

    return () => {
      for (const cleanup of cleanupFns) cleanup();
    };
  }, [currentTab, currentChannel, previewOpen]);
}
