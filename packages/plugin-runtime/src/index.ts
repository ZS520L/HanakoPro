export type MaybePromise<T> = T | Promise<T>;

export type JsonSchema = Record<string, unknown>;

export const HANA_BUS_SKIP = Symbol.for('hana.event-bus.skip');

export interface HanaToolResult {
  content?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
}

export interface HanaSessionFile {
  id?: string | null;
  fileId?: string | null;
  sessionPath?: string | null;
  filePath?: string;
  realPath?: string;
  displayName?: string;
  filename?: string;
  label?: string;
  ext?: string | null;
  mime?: string;
  size?: number;
  kind?: string;
  isDirectory?: boolean;
  origin?: string;
  operations?: unknown[];
  createdAt?: number | string;
  storageKind?: string;
  status?: string;
  missingAt?: number | string | null;
  [key: string]: unknown;
}

export interface HanaSessionFileMediaItem {
  type: 'session_file';
  fileId: string;
  sessionPath?: string | null;
  filePath?: string;
  label?: string;
  mime?: string;
  size?: number;
  kind?: string;
  [key: string]: unknown;
}

export interface HanaStagedSessionFile {
  file?: HanaSessionFile | null;
  sessionFile?: HanaSessionFile | null;
  mediaItem: HanaSessionFileMediaItem;
}

export interface HanaMediaDetails {
  media: {
    items: HanaSessionFileMediaItem[];
  };
}

export interface HanaToolContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  sessionPath?: string | null;
  bus: HanaEventBus;
  config: HanaPluginConfigStore;
  log: HanaPluginLogger;
  registerSessionFile?: (input: Record<string, unknown>) => HanaSessionFile;
  stageFile?: (input: Record<string, unknown>) => HanaStagedSessionFile;
  [key: string]: unknown;
}

export interface HanaToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  promptSnippet?: string;
  promptGuidelines?: string;
  execute(input: Input, ctx: HanaToolContext): MaybePromise<Output>;
}

export type HanaSlashPermission = 'anyone' | 'owner' | 'admin';
export type HanaSlashScope = 'session' | 'global';

export interface HanaCommandContext {
  [key: string]: unknown;
}

export interface HanaCommandResult {
  reply?: string;
  silent?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface HanaCommandDefinition<Context = HanaCommandContext> {
  name: string;
  aliases?: string[];
  description?: string;
  scope?: HanaSlashScope;
  permission?: HanaSlashPermission;
  usage?: string;
  handler?: (ctx: Context) => MaybePromise<HanaCommandResult | void>;
  execute?: (ctx: Context) => MaybePromise<unknown>;
}

export type HanaProviderRuntimeKind = 'http' | 'oauth-http' | 'local-cli' | 'browser-cli' | 'plugin';
export type HanaMediaCapabilityName = 'imageGeneration' | 'videoGeneration' | 'speechGeneration' | string;
export type HanaMediaOutputKind = 'file_glob' | 'json_stdout' | 'url_stdout';
export type HanaCliBindingSource = 'prompt' | 'modelId' | 'inputFile' | 'outputDir' | 'size' | 'duration';

export type HanaCliArgBinding =
  | { literal: string }
  | { option: string; from: HanaCliBindingSource };

export interface HanaCliOutputContract {
  kind: HanaMediaOutputKind;
  directory?: HanaCliBindingSource | string;
  pattern?: string;
  [key: string]: unknown;
}

export interface HanaCliCommandSpec {
  executable: string;
  args: HanaCliArgBinding[];
  timeoutMs: number;
  output: HanaCliOutputContract;
}

export interface HanaProviderRuntime {
  kind: HanaProviderRuntimeKind;
  protocolId?: string;
  command?: HanaCliCommandSpec;
  [key: string]: unknown;
}

export interface HanaProviderChatCapability {
  projection?: 'models-json' | 'sdk-auth-alias' | 'none' | string;
  runtimeProviderId?: string;
  displayProviderId?: string;
  allowListSource?: string;
  [key: string]: unknown;
}

export interface HanaProviderMediaModel {
  id: string;
  displayName?: string;
  protocolId: string;
  inputs?: string[];
  outputs?: string[];
  supportsEdit?: boolean;
  aliases?: string[];
  credentialLaneId?: string;
  [key: string]: unknown;
}

export interface HanaProviderCredentialLane {
  id: string;
  kind?: string;
  label?: string;
  [key: string]: unknown;
}

export interface HanaProviderMediaCapability {
  defaultModelId?: string;
  models: HanaProviderMediaModel[];
  credentialLanes?: HanaProviderCredentialLane[];
  [key: string]: unknown;
}

export interface HanaProviderCapabilities {
  chat?: HanaProviderChatCapability;
  media?: Partial<Record<HanaMediaCapabilityName, HanaProviderMediaCapability>>;
  [key: string]: unknown;
}

export interface HanaProviderSource {
  kind: 'builtin' | 'plugin' | 'user' | string;
  pluginId?: string;
  [key: string]: unknown;
}

export interface HanaProviderDefinition {
  id: string;
  displayName?: string;
  name?: string;
  authType?: 'api-key' | 'oauth' | 'none' | string;
  authJsonKey?: string;
  defaultBaseUrl?: string;
  defaultApi?: string;
  api?: string;
  models?: unknown[];
  runtime?: HanaProviderRuntime;
  capabilities?: HanaProviderCapabilities;
  source?: HanaProviderSource;
  [key: string]: unknown;
}

export type HanaExtensionFactory<Pi = unknown> = (pi: Pi) => MaybePromise<void>;

export interface HanaPluginConfigStore {
  get<T = unknown>(key: string, options?: HanaPluginConfigScopeOptions): MaybePromise<T | undefined>;
  getAll?(options?: HanaPluginConfigScopeOptions & { redacted?: boolean }): MaybePromise<Record<string, unknown>>;
  set<T = unknown>(key: string, value: T, options?: HanaPluginConfigScopeOptions): MaybePromise<void>;
  setMany?(values: Record<string, unknown>, options?: HanaPluginConfigScopeOptions): MaybePromise<Record<string, unknown>>;
  getSchema?(): JsonSchema;
}

export interface HanaPluginConfigScopeOptions {
  scope?: 'global' | 'per-agent' | 'per-session';
  agentId?: string;
  sessionPath?: string;
}

export interface HanaEventBus {
  emit(type: string, payload?: unknown): unknown;
  subscribe(type: string, handler: (payload: unknown) => void): () => void;
  request<T = unknown>(type: string, payload?: unknown, options?: Record<string, unknown>): Promise<T>;
  hasHandler?(type: string): boolean;
  handle?(type: string, handler: (payload: unknown) => MaybePromise<unknown>): () => void;
  listCapabilities?(): HanaEventBusCapability[];
  getCapability?(type: string): HanaEventBusCapability | null;
}

export interface HanaEventBusCapability {
  type: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permission: string;
  errors: string[];
  stability: string;
  owner: string;
  since?: string;
  available?: boolean;
}

export interface HanaPluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface HanaBusHandlerContext {
  pluginId: string;
  bus: HanaEventBus;
  config?: HanaPluginConfigStore;
  log?: HanaPluginLogger;
  [key: string]: unknown;
}

export interface HanaBusHandlerDefinition<
  Payload = unknown,
  Result = unknown,
  Context extends HanaBusHandlerContext = HanaBusHandlerContext,
> {
  type: string;
  handle(payload: Payload, ctx: Context): MaybePromise<Result>;
}

export interface HanaPluginContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  bus: HanaEventBus;
  config: HanaPluginConfigStore;
  log: HanaPluginLogger;
  registerTool?: (tool: HanaToolDefinition) => () => void;
  registerSessionFile?: (input: Record<string, unknown>) => HanaSessionFile;
  stageFile?: (input: Record<string, unknown>) => HanaStagedSessionFile;
  [key: string]: unknown;
}

export type HanaPluginDisposable = () => void;

export interface HanaPluginLifecycleHelpers {
  register(disposable: HanaPluginDisposable): void;
}

export interface HanaPluginLifecycle {
  onload?(ctx: HanaPluginContext, helpers: HanaPluginLifecycleHelpers): MaybePromise<void>;
  onunload?(ctx: HanaPluginContext): MaybePromise<void>;
}

export interface HanaPluginInstance {
  ctx: HanaPluginContext;
  register: (disposable: HanaPluginDisposable) => void;
  onload?(): MaybePromise<void>;
  onunload?(): MaybePromise<void>;
}

export type HanaTaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'aborted';

export interface HanaTaskProgress {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
}

export interface HanaTaskRecord {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  progress?: HanaTaskProgress | null;
  status: HanaTaskStatus;
  aborted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface HanaTaskSchedule {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number | null;
  runAt?: number | string | null;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: unknown;
  lastError?: string | null;
  runCount?: number;
}

export interface HanaTaskRegisterInput {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  persist?: boolean;
}

export interface HanaTaskUpdateInput {
  taskId: string;
  status?: HanaTaskStatus;
  progress?: HanaTaskProgress | null;
  meta?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
}

export interface HanaTaskScheduleInput {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number;
  runAt?: number | string | Date;
  enabled?: boolean;
}

const EMPTY_PARAMETERS: JsonSchema = { type: 'object', properties: {} };

export function defineTool<Input = unknown, Output = unknown>(
  definition: HanaToolDefinition<Input, Output>,
): HanaToolDefinition<Input, Output> & { parameters: JsonSchema } {
  return {
    ...definition,
    parameters: definition.parameters ?? EMPTY_PARAMETERS,
  };
}

export function defineCommand<Context = HanaCommandContext>(
  definition: HanaCommandDefinition<Context>,
): HanaCommandDefinition<Context> {
  return { ...definition };
}

export function defineProvider<T extends HanaProviderDefinition>(definition: T): T {
  return definition;
}

export function defineBusHandler<
  Payload = unknown,
  Result = unknown,
  Context extends HanaBusHandlerContext = HanaBusHandlerContext,
>(
  definition: HanaBusHandlerDefinition<Payload, Result, Context>,
): HanaBusHandlerDefinition<Payload, Result, Context> {
  return { ...definition };
}

export function requestBus<Result = unknown, Payload = unknown>(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  type: string,
  payload?: Payload,
  options?: Record<string, unknown>,
): Promise<Result> {
  if (!ctx.bus || typeof ctx.bus.request !== 'function') {
    throw new Error('plugin bus request unavailable');
  }
  return ctx.bus.request<Result>(type, payload, options);
}

export function registerTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  input: HanaTaskRegisterInput,
): Promise<{ ok: true }> {
  return requestBus(ctx, 'task:register', input);
}

export function updateTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  input: HanaTaskUpdateInput,
): Promise<{ ok: true; task: HanaTaskRecord }> {
  return requestBus(ctx, 'task:update', input);
}

export function completeTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  taskId: string,
  result?: unknown,
): Promise<{ ok: true; task: HanaTaskRecord }> {
  return requestBus(ctx, 'task:complete', { taskId, result });
}

export function failTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  taskId: string,
  error: unknown,
): Promise<{ ok: true; task: HanaTaskRecord }> {
  return requestBus(ctx, 'task:fail', { taskId, error });
}

export function cancelTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  taskId: string,
  reason?: string,
): Promise<{ result: string; canceled: boolean }> {
  return requestBus(ctx, 'task:cancel', { taskId, reason });
}

export function scheduleTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  input: HanaTaskScheduleInput,
): Promise<{ ok: true; schedule: HanaTaskSchedule }> {
  return requestBus(ctx, 'task:schedule', input);
}

export function unscheduleTask(
  ctx: { bus?: Pick<HanaEventBus, 'request'> | null },
  scheduleId: string,
): Promise<{ ok: true; removed: boolean }> {
  return requestBus(ctx, 'task:unschedule', { scheduleId });
}

export function sessionFileToMediaItem(file: HanaSessionFile): HanaSessionFileMediaItem {
  const fileId = firstText(file.fileId, file.id);
  if (!fileId) {
    throw new Error('SessionFile media item requires id or fileId');
  }

  const item: HanaSessionFileMediaItem = {
    type: 'session_file',
    fileId,
  };
  assignDefined(item, 'sessionPath', file.sessionPath);
  assignDefined(item, 'filePath', file.filePath);
  assignDefined(item, 'label', firstText(file.label, file.displayName, file.filename));
  assignDefined(item, 'mime', file.mime);
  assignDefined(item, 'size', file.size);
  assignDefined(item, 'kind', file.kind);
  return item;
}

type HanaMediaInput = HanaSessionFile | HanaSessionFileMediaItem | HanaStagedSessionFile;

export function createMediaDetails(items: HanaMediaInput[]): HanaMediaDetails {
  return {
    media: {
      items: items.map(normalizeMediaItem),
    },
  };
}

export function defineExtension<Pi = unknown>(factory: HanaExtensionFactory<Pi>): HanaExtensionFactory<Pi> {
  return factory;
}

export function definePlugin(lifecycle: HanaPluginLifecycle): new () => HanaPluginInstance {
  return class DefinedHanaPlugin implements HanaPluginInstance {
    ctx!: HanaPluginContext;
    register!: (disposable: HanaPluginDisposable) => void;

    async onload(): Promise<void> {
      await lifecycle.onload?.(this.ctx, { register: this.register });
    }

    async onunload(): Promise<void> {
      await lifecycle.onunload?.(this.ctx);
    }
  };
}

function normalizeMediaItem(input: HanaMediaInput): HanaSessionFileMediaItem {
  if (isRecord(input) && isRecord(input.mediaItem)) {
    return normalizeSessionFileMediaItem(input.mediaItem);
  }
  if (isRecord(input) && input.type === 'session_file') {
    return normalizeSessionFileMediaItem(input);
  }
  if (isRecord(input)) {
    return sessionFileToMediaItem(input);
  }
  throw new Error('media details item must be a SessionFile, staged file, or session_file media item');
}

function normalizeSessionFileMediaItem(input: Record<string, unknown>): HanaSessionFileMediaItem {
  if (input.type !== 'session_file') {
    throw new Error('media details item must be a session_file media item');
  }
  const fileId = firstText(input.fileId);
  if (!fileId) {
    throw new Error('SessionFile media item requires fileId');
  }
  return {
    ...input,
    type: 'session_file',
    fileId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}
