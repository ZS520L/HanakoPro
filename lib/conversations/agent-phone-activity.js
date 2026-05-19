/**
 * In-memory Agent Phone activity snapshot.
 *
 * 持久事实写入 per-agent projection；这个 store 负责运行期 UI 快照和 WS 事件。
 */

const DEFAULT_HISTORY_LIMIT = 20;

function keyFor(conversationId, agentId) {
  return `${conversationId}::${agentId}`;
}

export class AgentPhoneActivityStore {
  constructor({ emit, now, historyLimit = DEFAULT_HISTORY_LIMIT } = {}) {
    this._emit = emit || (() => {});
    this._now = now || (() => new Date().toISOString());
    this._historyLimit = historyLimit;
    this._latest = new Map();
    this._history = new Map();
  }

  record({ conversationId, conversationType, agentId, state, summary, details = null, timestamp = this._now() }) {
    if (!conversationId) throw new Error("conversationId is required");
    if (!conversationType) throw new Error("conversationType is required");
    if (!agentId) throw new Error("agentId is required");
    if (!state) throw new Error("state is required");

    const activity = {
      conversationId,
      conversationType,
      agentId,
      state,
      summary: summary || state,
      timestamp,
      details,
    };
    const key = keyFor(conversationId, agentId);
    this._latest.set(key, activity);
    const history = this._history.get(key) || [];
    history.unshift(activity);
    this._history.set(key, history.slice(0, this._historyLimit));

    this._emit({
      type: "conversation_agent_activity",
      activity,
    });
    return activity;
  }

  snapshot(conversationId) {
    if (!conversationId) return [];
    return Array.from(this._latest.values())
      .filter((activity) => activity.conversationId === conversationId)
      .sort((a, b) => a.agentId.localeCompare(b.agentId));
  }

  history(conversationId, agentId) {
    return this._history.get(keyFor(conversationId, agentId)) || [];
  }
}
