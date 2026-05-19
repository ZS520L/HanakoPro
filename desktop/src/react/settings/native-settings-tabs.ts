import React from 'react';
import { McpTab } from './tabs/McpTab';

const NATIVE_SETTINGS_TABS: Record<string, React.ComponentType> = {
  'mcp.settings': McpTab,
};

export function getNativeSettingsTabComponent(id: string): React.ComponentType | null {
  return NATIVE_SETTINGS_TABS[id] || null;
}
