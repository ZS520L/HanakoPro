/**
 * list-agent-sessions.js — /rc 菜单的数据源
 *
 * 从 engine.listSessions() 取指定 agent 的最近 N 条桌面 session，
 * 附 1-based index、path、title、modified、messageCount。
 *
 * 过滤规则（对齐 Phase 2 /rc 设计）：
 *   - 仅当前 agentId 的 sessions（bridge sessionKey 内嵌 agentId，锁死身份）
 *   - 排除 `/.ephemeral/` 下的临时 session（engine.listSessions 默认就不返回，这里再兜底防御）
 *   - 可通过 excludePaths 排除当前 bridge session 本身（上层决定要不要传）
 *   - listSessions() 已按 modified 降序，slice(0, limit) 即取最近 N 条
 *
 * 不在这里做 title 兜底文案（"未命名..."这类）——留给调用方格式化消息时做，
 * 本函数保持"数据提取器"单一职责。
 */

const DEFAULT_LIMIT = 10;
const EPHEMERAL_SEGMENT_RE = /(^|[\\/])\.ephemeral([\\/]|$)/;

/**
 * @typedef {object} AgentSessionSummary
 * @property {number} index  1-based，对应用户将会输入的数字
 * @property {string} path   桌面 session 绝对路径
 * @property {string | null} title
 * @property {Date | number} modified
 * @property {number} messageCount
 */

/**
 * @param {object} engine  必须实现 listSessions(): Promise<Array<{path, agentId, title?, modified, messageCount?}>>
 * @param {string} agentId
 * @param {{ limit?: number, excludePaths?: string[] }} [opts]
 * @returns {Promise<AgentSessionSummary[]>}
 */
export async function listRecentAgentSessions(engine, agentId, opts = {}) {
  if (!agentId) throw new Error("listRecentAgentSessions: agentId required");
  if (typeof engine?.listSessions !== "function") {
    throw new Error("listRecentAgentSessions: engine.listSessions missing");
  }
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const excludeSet = new Set(opts.excludePaths || []);

  const all = await engine.listSessions();
  return all
    .filter(s => s.agentId === agentId)
    .filter(s => !excludeSet.has(s.path))
    // 防御性：.ephemeral 理论上 listSessions 就过滤掉了，这里再兜一次防止上游 regress
    .filter(s => !EPHEMERAL_SEGMENT_RE.test(s.path))
    .slice(0, limit)
    .map((s, i) => ({
      index: i + 1,
      path: s.path,
      title: s.title || null,
      modified: s.modified,
      messageCount: s.messageCount ?? 0,
    }));
}
