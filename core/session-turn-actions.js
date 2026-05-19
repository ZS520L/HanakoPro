import { submitDesktopSessionMessage } from "./desktop-session-submit.js";

const ATTACHMENT_MARKER_RE = /^\[(attached_(?:image|video):[^\]]+)\]\s*$/;

export async function replayLatestUserTurn(engine, opts = {}, deps = {}) {
  const submit = deps.submit || submitDesktopSessionMessage;
  const {
    sessionPath,
    sourceEntryId,
    clientMessageId,
    replacementText,
    displayMessage,
    uiContext,
  } = opts;

  if (!engine || typeof engine.ensureSessionLoaded !== "function") {
    throw new Error("latest user replay requires engine.ensureSessionLoaded");
  }
  if (!sessionPath) throw new Error("sessionPath is required");
  if (typeof engine.isSessionStreaming === "function" && engine.isSessionStreaming(sessionPath)) {
    throw new Error("session_busy");
  }
  if (replacementText != null && !String(replacementText).trim()) {
    throw new Error("replacement text is required");
  }

  const session = await engine.ensureSessionLoaded(sessionPath);
  if (!session?.sessionManager) {
    throw new Error(`failed to load session ${sessionPath}`);
  }

  const latest = findLatestUserEntry(session.sessionManager.getBranch());
  if (!latest) throw new Error("No latest user message to replay");
  if (sourceEntryId && latest.id !== sourceEntryId) {
    throw new Error("Requested message is not the latest user message");
  }

  const original = promptPayloadFromUserMessage(latest.message);
  const promptText = replacementText == null
    ? original.text
    : mergeAttachmentMarkers(original.text, String(replacementText));

  if (typeof session.navigateTree === "function") {
    const result = await session.navigateTree(latest.id, { summarize: false });
    if (result?.cancelled) throw new Error("latest user replay cancelled");
  } else if (latest.parentId) {
    session.sessionManager.branch(latest.parentId);
    replaceAgentMessagesFromBranch(session);
  } else {
    session.sessionManager.resetLeaf();
    replaceAgentMessagesFromBranch(session);
  }

  engine.emitEvent?.({
    type: "session_branch_reset",
    messageId: latest.id,
    clientMessageId: clientMessageId || null,
  }, sessionPath);

  return await submit(engine, {
    sessionPath,
    text: promptText,
    images: original.images.length ? original.images : undefined,
    displayMessage: {
      ...(displayMessage || {}),
      text: displayMessage?.text ?? (replacementText == null ? visibleUserText(original.text) : String(replacementText)),
    },
    uiContext,
  });
}

function findLatestUserEntry(branch) {
  if (!Array.isArray(branch)) return null;
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type === "message" && entry.message?.role === "user") return entry;
  }
  return null;
}

function promptPayloadFromUserMessage(message) {
  const content = message?.content;
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };

  const text = content
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("");
  const images = content
    .filter(block => block?.type === "image")
    .map(block => ({ ...block }));
  return { text, images };
}

function mergeAttachmentMarkers(originalText, replacementText) {
  const markers = [];
  for (const line of String(originalText || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!ATTACHMENT_MARKER_RE.test(trimmed)) break;
    markers.push(trimmed);
  }
  return markers.length ? `${markers.join("\n")}\n${replacementText}` : replacementText;
}

function visibleUserText(text) {
  const lines = String(text || "").split(/\r?\n/);
  while (lines.length && ATTACHMENT_MARKER_RE.test(lines[0].trim())) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

/**
 * Revert the latest assistant turn — branch back to the user message,
 * removing the assistant response, but do NOT re-submit.
 * Caller is responsible for restoring file checkpoints separately.
 */
export async function revertLatestAssistantTurn(engine, opts = {}) {
  const { sessionPath, clientMessageId, sinceTs } = opts;
  if (!engine || typeof engine.ensureSessionLoaded !== "function") {
    throw new Error("revert requires engine.ensureSessionLoaded");
  }
  if (!sessionPath) throw new Error("sessionPath is required");
  if (typeof engine.isSessionStreaming === "function" && engine.isSessionStreaming(sessionPath)) {
    throw new Error("session_busy");
  }

  const session = await engine.ensureSessionLoaded(sessionPath);
  if (!session?.sessionManager) {
    throw new Error(`failed to load session ${sessionPath}`);
  }

  const branch = session.sessionManager.getBranch();
  const latest = findRevertTargetUserEntry(branch, sinceTs);
  if (!latest) throw new Error("No user message to revert to");

  const branchToId = latest.parentId || null;

  if (typeof session.sessionManager.branchWithSummary === "function") {
    session.sessionManager.branchWithSummary(branchToId, "", { reason: "revert", revertedUserId: latest.id }, "hanako-revert");
    replaceAgentMessagesFromBranch(session);
  } else if (typeof session.sessionManager.branch === "function") {
    if (branchToId) session.sessionManager.branch(branchToId);
    else session.sessionManager.resetLeaf();
    replaceAgentMessagesFromBranch(session);
  } else if (typeof session.navigateTree === "function") {
    const result = await session.navigateTree(latest.id, { summarize: false });
    if (result?.cancelled) throw new Error("revert cancelled");
  } else if (latest.parentId) {
    session.sessionManager.branch(latest.parentId);
    replaceAgentMessagesFromBranch(session);
  } else {
    session.sessionManager.resetLeaf();
    replaceAgentMessagesFromBranch(session);
  }

  // 注意：revert 不发 session_branch_reset 事件——前端在 revertTurn() 成功后会主动 loadMessages 拉最新状态。
  // 如果这里发事件，WS handler 会 bumpMessageLiveVersion 让 loadMessages 跳过应用，造成竞态。
  // （与 replay 不同：replay 紧接着 prompt 流，需要事件触发 UI truncate；revert 不会再发新内容。）
  void clientMessageId;

  return { ok: true, branchedToMessageId: branchToId, revertedUserMessageId: latest.id };
}

function findRevertTargetUserEntry(branch, preferredSinceTs) {
  if (!Array.isArray(branch)) return null;
  const preferredMs = timestampMs(preferredSinceTs);
  if (preferredMs > 0) {
    let best = null;
    let bestDelta = Infinity;
    for (let i = branch.length - 1; i >= 0; i -= 1) {
      const entry = branch[i];
      if (entry?.type !== "message" || entry.message?.role !== "user") continue;
      if (!hasAssistantResponseForUserAt(branch, i)) continue;
      const ts = timestampMs(entry.timestamp);
      if (ts <= 0) continue;
      const delta = Math.abs(ts - preferredMs);
      if (delta < bestDelta) {
        best = entry;
        bestDelta = delta;
      }
    }
    if (best && bestDelta <= 5 * 60 * 1000) return best;
  }

  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    if (hasAssistantResponseForUserAt(branch, i)) return entry;
  }
  return null;
}

function hasAssistantResponseForUserAt(branch, userIdx) {
  for (let i = userIdx + 1; i < branch.length; i += 1) {
    const entry = branch[i];
    if (entry?.type !== "message") continue;
    if (entry.message?.role === "user") return false;
    if (entry.message?.role === "assistant") return true;
  }
  return false;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function replaceAgentMessagesFromBranch(session) {
  const context = session.sessionManager.buildSessionContext();
  if (session.agent?.replaceMessages) {
    session.agent.replaceMessages(context.messages);
  } else if (session.agent?.state) {
    session.agent.state.messages = context.messages;
  }
}
