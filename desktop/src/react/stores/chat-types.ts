/**
 * chat-types.ts — 聊天消息数据模型
 *
 * 历史消息和流式消息共用同一套类型。
 * ContentBlock 按展示顺序排列（thinking → mood → tools → text），
 * 不按流式到达顺序。
 */


// ── 工具调用 ──

export interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
  done: boolean;
  success: boolean;
  pendingToolStart?: boolean;
  prepareKey?: string;
  progress?: {
    stage?: string;
    filePath?: string | null;
    fileName?: string | null;
    rawPath?: string | null;
    operation?: string | null;
    bytesWritten?: number;
    totalBytes?: number;
    progress?: number;
    previewText?: string;
    previewTruncated?: boolean;
    error?: string;
    warning?: string;
  };
  details?: { card?: import('../types').PluginCardDetails; [key: string]: unknown };
}

// ── 用户附件 ──

export interface UserAttachment {
  fileId?: string;
  path: string;
  name: string;
  isDir: boolean;
  base64Data?: string;
  mimeType?: string;
  status?: 'available' | 'expired' | string;
  missingAt?: number | null;
  visionAuxiliary?: boolean;
}

export interface DeskContext {
  dir: string;
  fileCount: number;
}

export interface SessionRegistryFile {
  id?: string;
  fileId?: string;
  sessionPath?: string;
  filePath?: string;
  realPath?: string;
  label?: string;
  displayName?: string;
  filename?: string;
  ext?: string;
  mime?: string;
  kind?: string;
  status?: 'available' | 'expired' | string;
  missingAt?: number | null;
  origin?: string;
  operations?: string[];
  createdAt?: number;
  isDirectory?: boolean;
}

// ── 内容块 ──

export interface SessionConfirmationBlock {
  type: 'session_confirmation';
  confirmId: string;
  kind: string;
  surface: 'input' | 'message';
  status: 'pending' | 'confirmed' | 'rejected' | 'timeout' | 'aborted';
  title: string;
  body?: string;
  subject?: {
    label: string;
    detail?: string;
  };
  severity?: 'normal' | 'elevated' | 'danger';
  actions?: {
    confirmLabel?: string;
    rejectLabel?: string;
  };
  payload?: Record<string, unknown>;
}

// 物种 A：文本装饰器（流式组装，upsert 到 blocks 数组）
export type TextDecorator =
  | { type: 'thinking'; content: string; sealed: boolean }
  | { type: 'mood'; yuan: string; text: string }
  | {
    type: 'vision_progress';
    requestId: string;
    phase: 'running' | 'done' | 'error';
    imageIndex?: number;
    imageCount?: number;
    resourceLabel?: string | null;
    model?: { id?: string; provider?: string } | null;
    targetModel?: { id?: string; provider?: string } | null;
    question?: string;
    response?: string;
    error?: string;
    elapsedMs?: number;
    reused?: boolean;
  }
  | { type: 'tool_group'; tools: ToolCall[]; collapsed: boolean }
  | { type: 'text'; html: string; source?: string };

// 物种 B：富内容块（通过 content_block 事件 push，不 upsert）
export type RichBlock =
  | { type: 'file'; fileId?: string; filePath: string; label: string; ext: string; mime?: string; kind?: string; storageKind?: string; status?: 'available' | 'expired' | string; missingAt?: number | null }
  // COMPAT(create_artifact, remove no earlier than v0.133 after legacy sessions are migrated)
  | { type: 'artifact'; artifactId: string; artifactType: string; title: string; content: string; language?: string | null; fileId?: string; filePath?: string; label?: string; ext?: string; mime?: string; kind?: string; storageKind?: string; status?: 'available' | 'expired' | string; missingAt?: number | null }
  | { type: 'screenshot'; base64: string; mimeType: string }
  | { type: 'skill'; skillName: string; skillFilePath: string; fileId?: string; installedFile?: Record<string, unknown>; installedSkillSource?: Record<string, unknown> }
  | { type: 'cron_confirm'; confirmId?: string; jobData: Record<string, unknown>; status: 'pending' | 'approved' | 'rejected' }
  | { type: 'settings_confirm'; confirmId?: string; settingKey: string; cardType: 'toggle' | 'list' | 'text'; currentValue: string; proposedValue: string; options?: string[]; optionLabels?: Record<string, string>; label: string; description?: string; frontend?: boolean; status: 'pending' | 'confirmed' | 'rejected' | 'timeout' }
  | SessionConfirmationBlock
  | {
    type: 'subagent';
    taskId: string;
    task: string;
    taskTitle: string;
    agentId?: string;
    agentName?: string;
    requestedAgentId?: string;
    requestedAgentName?: string;
    executorAgentId?: string;
    executorAgentNameSnapshot?: string;
    streamKey: string;
    streamStatus: 'running' | 'done' | 'failed' | 'aborted';
    summary?: string;
  }
  | { type: 'plugin_card'; card: import('../types').PluginCardDetails };

export type ContentBlock = TextDecorator | RichBlock;

// ── 消息 ──

export interface ChatMessage {
  id: string;              // 服务端返回的稳定 ID（JSONL 行号）
  sourceEntryId?: string;  // Pi SDK session entry id，用于 branch-aware 的重新生成/编辑
  role: 'user' | 'assistant';
  // User
  text?: string;
  textHtml?: string;
  quotedText?: string;
  attachments?: UserAttachment[];
  deskContext?: DeskContext | null;
  skills?: string[];
  // Assistant
  blocks?: ContentBlock[];
  // 通用
  timestamp?: number;
}

// ── Virtuoso 列表项 ──

export type ChatListItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'compaction'; id: string; yuan: string };

// ── Per-session 模型快照 ──
// 挂在 chat-slice 的 sessionModelsByPath keyed map 上，
// 与消息缓存 SessionMessages 解耦：模型信息可以在消息还没加载时独立写入，
// 不会因为在 chatSessions 里创建 stub 而骗过"是否已加载"的判据（issue #405）。

export interface SessionModel {
  id: string;
  name: string;
  provider: string;
  /** 输入模态数组（Pi SDK 标准字段），镜像后端 /models, /models/switch 响应。 */
  input?: ("text" | "image" | "video")[];
  video?: boolean;
  videoTransport?: string | null;
  videoTransportSupported?: boolean;
  reasoning?: boolean;
  xhigh?: boolean;
  contextWindow?: number;
}

// ── Per-session 消息状态 ──
// entry 存在 ⟺ 消息状态已初始化（initSession 调用过）。
// 不要为了存别的东西（例如模型快照）就写 stub 进来——会把这个语义打破。

export interface SessionMessages {
  items: ChatListItem[];
  hasMore: boolean;
  loadingMore: boolean;
  oldestId?: string;
}

// ── 流式缓冲（不入 Zustand） ──

export interface StreamBuffer {
  sessionPath: string;
  textAcc: string;
  thinkingAcc: string;
  moodAcc: string;
  moodYuan: string;
  inThinking: boolean;
  inMood: boolean;
  lastFlushTime: number;
}
