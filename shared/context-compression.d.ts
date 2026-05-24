export interface CompressionModeDefinition {
  id: string;
  nameKey: string;
  descKey: string;
}

export interface ContextCompressionProtect {
  systemPrompt: boolean;
  pinnedMemory: boolean;
  recentToolResults: boolean;
}

export interface ContextCompressionConfig {
  enabled: boolean;
  threshold: number;
  recentTurnsProtected: number;
  mode: string;
  customPrompt: string;
  compressionModel: string;
  protect: ContextCompressionProtect;
}

export declare const COMPRESSION_MODES: readonly CompressionModeDefinition[];
export declare const BUILTIN_MODE_PROMPTS: Readonly<Record<string, string>>;
export declare const DEFAULT_CONTEXT_COMPRESSION: Readonly<ContextCompressionConfig>;
