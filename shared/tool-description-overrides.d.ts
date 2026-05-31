export type ToolDescriptionParameterOverride = {
  path: string;
  description: string;
};

export type ToolDescriptionOverride = {
  name: string;
  description?: string;
  enabled?: boolean;
  parameters: ToolDescriptionParameterOverride[];
};

export type ToolDescriptionEntry = {
  kind: 'tool' | 'parameter';
  path: string;
  description: string;
};

export type ToolDescriptionSummary = {
  name: string;
  label: string;
  description: string;
  parameters: ToolDescriptionEntry[];
};

export function normalizeToolDescriptionOverrides(value: unknown): ToolDescriptionOverride[];
export function collectToolDescriptionEntries(tool: unknown): ToolDescriptionEntry[];
export function summarizeToolDescriptions(tools?: unknown[]): ToolDescriptionSummary[];
export function applyToolDescriptionOverrides<T>(tools?: T[], overrides?: unknown): T[];
