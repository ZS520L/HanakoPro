/**
 * agent-id-resolver.js — 把用户传入的 agent 标识解析成真实 agent.id
 *
 * 防御 LLM 把 system prompt roster 里加粗的显示名当 identifier 用：
 * - 优先按 id 严格匹配
 * - id 找不到时按 name 兜底，仅当唯一匹配时才接受，避免歧义
 */

/**
 * @param {Array<{id: string, name?: string}>} agents
 * @param {string|undefined} raw
 * @returns {{ ok: true, agentId: string|undefined } | { ok: false, ambiguous: boolean, byName: Array }}
 */
export function resolveAgentParam(agents, raw) {
  if (!raw) return { ok: true, agentId: undefined };

  const byId = agents.find(a => a.id === raw);
  if (byId) return { ok: true, agentId: byId.id };

  const byName = agents.filter(a => a.name === raw);
  if (byName.length === 1) return { ok: true, agentId: byName[0].id };

  return { ok: false, ambiguous: byName.length > 1, byName };
}
