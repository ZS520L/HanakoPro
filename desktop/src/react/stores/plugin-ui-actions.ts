import { useStore } from './index';
import { hanaFetch } from '../hooks/use-hana-fetch';
import type { PluginPageInfo, PluginUiHostCapabilityGrant, PluginWidgetInfo } from '../types';

function collectPluginUiHostCapabilities(
  pages: PluginPageInfo[],
  widgets: PluginWidgetInfo[],
  grants: PluginUiHostCapabilityGrant[],
): Record<string, string[]> {
  const byPlugin: Record<string, string[]> = {};
  const add = (pluginId: string, hostCapabilities: string[] | undefined) => {
    if (!pluginId || !Array.isArray(hostCapabilities)) return;
    const set = new Set(byPlugin[pluginId] || []);
    for (const capability of hostCapabilities) {
      if (typeof capability === 'string' && capability.trim()) set.add(capability);
    }
    byPlugin[pluginId] = [...set];
  };
  for (const page of pages) add(page.pluginId, page.hostCapabilities);
  for (const widget of widgets) add(widget.pluginId, widget.hostCapabilities);
  for (const grant of grants) add(grant.pluginId, grant.hostCapabilities);
  return byPlugin;
}

/** Fetch plugin pages, widgets, and persisted UI prefs from backend, update store. */
export async function refreshPluginUI(): Promise<void> {
  try {
    let pages: PluginPageInfo[] = [];
    let widgets: PluginWidgetInfo[] = [];
    let hostCapabilityGrants: PluginUiHostCapabilityGrant[] = [];

    const [pagesResult, widgetsResult, grantsResult, prefsResult] = await Promise.allSettled([
      hanaFetch('/api/plugins/pages').then(r => r.json()),
      hanaFetch('/api/plugins/widgets').then(r => r.json()),
      hanaFetch('/api/plugins/ui-host-capabilities').then(r => r.json()),
      hanaFetch('/api/preferences/plugin-ui').then(r => r.json()),
    ]);
    if (pagesResult.status === 'fulfilled') pages = pagesResult.value;
    if (widgetsResult.status === 'fulfilled') widgets = widgetsResult.value;
    if (grantsResult.status === 'fulfilled' && Array.isArray(grantsResult.value)) {
      hostCapabilityGrants = grantsResult.value;
    }

    const s = useStore.getState();
    s.setPluginPages(pages);
    s.setPluginWidgets(widgets);
    s.setPluginUiHostCapabilities(collectPluginUiHostCapabilities(pages, widgets, hostCapabilityGrants));

    if (prefsResult.status === 'fulfilled') {
      const prefs = prefsResult.value;
      if (Array.isArray(prefs.hiddenWidgets)) s.setHiddenWidgets(prefs.hiddenWidgets);
      if (Array.isArray(prefs.hiddenTabs)) s.setHiddenPluginTabs(prefs.hiddenTabs);
      if (Array.isArray(prefs.tabOrder)) s.setTabOrder(prefs.tabOrder);
    }

    // If current tab is a removed plugin tab, switch to chat
    const currentTab = s.currentTab;
    if (typeof currentTab === 'string' && currentTab.startsWith('plugin:')) {
      const pluginId = currentTab.slice(7);
      if (!pages.some(p => p.pluginId === pluginId)) {
        s.setCurrentTab('chat');
      }
    }

    // If jianView references a removed widget, reset to desk
    if (s.jianView.startsWith('widget:')) {
      const widgetId = s.jianView.slice(7);
      if (!widgets.some(w => w.pluginId === widgetId)) {
        s.setJianView('desk');
      }
    }
  } catch (err) {
    console.warn('[plugin-ui] Failed to refresh:', err);
  }
}

function persistField(field: Record<string, unknown>): void {
  hanaFetch('/api/preferences/plugin-ui', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(field),
  }).catch(err => console.warn('[plugin-ui] Failed to persist prefs:', err));
}

/** Hide a widget from the titlebar. */
export function hideWidget(pluginId: string): void {
  const s = useStore.getState();
  if (!s.hiddenWidgets.includes(pluginId)) {
    const next = [...s.hiddenWidgets, pluginId];
    s.setHiddenWidgets(next);
    if (s.jianView === `widget:${pluginId}`) s.setJianView('desk');
    persistField({ hiddenWidgets: next });
  }
}

/** Show a previously hidden widget. */
export function showWidget(pluginId: string): void {
  const s = useStore.getState();
  const next = s.hiddenWidgets.filter(id => id !== pluginId);
  s.setHiddenWidgets(next);
  persistField({ hiddenWidgets: next });
}

/** Switch jian sidebar to a widget view. */
export function openWidget(pluginId: string): void {
  const s = useStore.getState();
  s.setJianView(`widget:${pluginId}`);
  if (!s.jianOpen) {
    s.setJianOpen(true);
  }
}

/** Switch jian sidebar back to desk. */
export function openDesk(): void {
  useStore.getState().setJianView('desk');
}

/** Hide a plugin tab from the tab bar. */
export function hidePluginTab(tabId: string): void {
  const s = useStore.getState();
  const pluginId = tabId.startsWith('plugin:') ? tabId.slice(7) : tabId;
  if (!s.hiddenPluginTabs.includes(pluginId)) {
    const next = [...s.hiddenPluginTabs, pluginId];
    s.setHiddenPluginTabs(next);
    if (s.currentTab === `plugin:${pluginId}`) s.setCurrentTab('chat');
    persistField({ hiddenTabs: next });
  }
}

/** Show a previously hidden plugin tab. */
export function showPluginTab(tabId: string): void {
  const s = useStore.getState();
  const pluginId = tabId.startsWith('plugin:') ? tabId.slice(7) : tabId;
  const next = s.hiddenPluginTabs.filter(id => id !== pluginId);
  s.setHiddenPluginTabs(next);
  persistField({ hiddenTabs: next });
}

/** Reorder tabs (called after drag-drop). */
export function reorderTabs(newOrder: string[]): void {
  useStore.getState().setTabOrder(newOrder);
  persistField({ tabOrder: newOrder });
}
