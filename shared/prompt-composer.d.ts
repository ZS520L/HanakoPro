export type PromptComposerBlock = {
  id: string;
  title: string;
  content: string;
  enabled?: boolean;
};

export type PromptComposerRoute = {
  id: string;
  name: string;
  blockIds: string[];
  blockOverrides?: PromptComposerBlockOverride[];
};

export type PromptComposerBlockOverride = {
  id: string;
  content: string;
  enabled?: boolean;
};

export type PromptComposerToolParameterOverride = {
  path: string;
  description: string;
};

export type PromptComposerToolOverride = {
  name: string;
  description?: string;
  enabled?: boolean;
  parameters: PromptComposerToolParameterOverride[];
};

export type PromptSimplePreset = {
  id: string;
  name: string;
  content: string;
};

export type BuiltinSimplePromptTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
};

export type PromptComposerConfig = {
  enabled: boolean;
  mode: "blocks" | "simple";
  activeRouteId: string;
  activeSimplePresetId: string;
  simpleContent: string;
  simplePresets: PromptSimplePreset[];
  blockOverrides: PromptComposerBlockOverride[];
  blocks: PromptComposerBlock[];
  routes: PromptComposerRoute[];
  toolOverrides: PromptComposerToolOverride[];
};

export type BuiltinPromptBlockMeta = {
  id: string;
  label: string;
  labelEn: string;
};

export const DEFAULT_PROMPT_BLOCK_ORDER: string[];
export const SYSTEM_GENERATED_PROMPT_BLOCK_IDS: string[];
export const DEFAULT_SIMPLE_PROMPT_TEMPLATE_ID: string;
export const BUILTIN_SIMPLE_PROMPT_TEMPLATES: BuiltinSimplePromptTemplate[];
export const PROMPT_COMPOSER_MODES: Array<"blocks" | "simple">;
export const BUILTIN_PROMPT_BLOCKS: BuiltinPromptBlockMeta[];
export function createDefaultPromptComposerConfig(): PromptComposerConfig;
export function normalizePromptComposerConfig(value: unknown): PromptComposerConfig;
export function composePromptFromBlocks(args?: {
  config?: unknown;
  builtInBlocks?: Array<{ id: string; content: string }>;
  variables?: Record<string, unknown>;
}): string | null;
