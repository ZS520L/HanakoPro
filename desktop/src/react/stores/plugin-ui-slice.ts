import type { PluginPageInfo, PluginWidgetInfo } from '../types';

export interface PluginUiSlice {
  pluginPages: PluginPageInfo[];
  pluginWidgets: PluginWidgetInfo[];
  pluginUiHostCapabilities: Record<string, string[]>;
  tabOrder: string[];
  hiddenWidgets: string[];
  hiddenPluginTabs: string[];
  jianView: string;

  setPluginPages(pages: PluginPageInfo[]): void;
  setPluginWidgets(widgets: PluginWidgetInfo[]): void;
  setPluginUiHostCapabilities(grants: Record<string, string[]>): void;
  setTabOrder(order: string[]): void;
  setHiddenWidgets(ids: string[]): void;
  setHiddenPluginTabs(ids: string[]): void;
  setJianView(view: string): void;
}

export const createPluginUiSlice = (
  set: (partial: Partial<PluginUiSlice>) => void,
): PluginUiSlice => ({
  pluginPages: [],
  pluginWidgets: [],
  pluginUiHostCapabilities: {},
  tabOrder: [],
  hiddenWidgets: [],
  hiddenPluginTabs: [],
  jianView: 'desk',

  setPluginPages: (pages) => set({ pluginPages: pages }),
  setPluginWidgets: (widgets) => set({ pluginWidgets: widgets }),
  setPluginUiHostCapabilities: (grants) => set({ pluginUiHostCapabilities: grants }),
  setTabOrder: (order) => set({ tabOrder: order }),
  setHiddenWidgets: (ids) => set({ hiddenWidgets: ids }),
  setHiddenPluginTabs: (ids) => set({ hiddenPluginTabs: ids }),
  setJianView: (view) => set({ jianView: view }),
});
