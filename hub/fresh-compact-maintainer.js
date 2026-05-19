import fs from "fs";
import {
  listAgentPhoneProjectionFiles,
  readAgentPhoneProjection,
  resolveAgentPhoneStoredSessionPath,
} from "../lib/conversations/agent-phone-projection.js";
import { shouldRunFreshCompact } from "../lib/fresh-compact/policy.js";
import { freshCompactAgentPhoneSession } from "./agent-executor.js";

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FreshCompactMaintainer {
  /**
   * @param {object} opts
   * @param {import('./index.js').Hub} opts.hub
   */
  constructor({ hub, delayBetweenJobsMs = 5_000 } = {}) {
    this._hub = hub;
    this._delayBetweenJobsMs = delayBetweenJobsMs;
    this._running = false;
  }

  get _engine() { return this._hub.engine; }

  _listAgents() {
    const agents = this._engine.agents;
    if (agents instanceof Map) return [...agents.values()].filter(Boolean);
    if (Array.isArray(agents)) return agents.filter(Boolean);
    return [];
  }

  _listPhoneTargets(agent, now) {
    const targets = [];
    for (const filePath of listAgentPhoneProjectionFiles(agent.agentDir)) {
      const projection = readAgentPhoneProjection(filePath);
      const meta = projection.meta || {};
      const conversationId = meta.conversationId;
      const conversationType = meta.conversationType;
      if (!conversationId || !conversationType) continue;
      const sessionPath = resolveAgentPhoneStoredSessionPath(agent.agentDir, meta.phoneSessionFile);
      if (!sessionPath || !fs.existsSync(sessionPath)) continue;
      const decision = shouldRunFreshCompact({ meta, now });
      if (!decision.run) continue;
      targets.push({
        agentId: agent.id,
        conversationId,
        conversationType,
        reason: decision.reason || "daily",
      });
    }
    return targets;
  }

  async runDaily({ now = new Date() } = {}) {
    if (this._running) return { retry: true, staleRemaining: 1 };
    this._running = true;
    const result = {
      bridgeCompacted: 0,
      phoneCompacted: 0,
      failed: 0,
      staleRemaining: 0,
    };

    try {
      for (const agent of this._listAgents()) {
        const bridgeTargets = this._engine.bridgeSessionManager
          ?.listDailyFreshCompactTargets?.(agent, { now }) || [];
        for (const target of bridgeTargets) {
          try {
            await this._engine.bridgeSessionManager.freshCompactSession(target.sessionKey, {
              agentId: agent.id,
              reason: "daily",
              now,
            });
            result.bridgeCompacted += 1;
          } catch (err) {
            result.failed += 1;
            result.staleRemaining += 1;
            console.warn(`[fresh-compact] bridge ${agent.id}/${target.sessionKey} skipped: ${err?.message || err}`);
          }
          await sleep(this._delayBetweenJobsMs);
        }

        const phoneTargets = this._listPhoneTargets(agent, now);
        for (const target of phoneTargets) {
          try {
            await freshCompactAgentPhoneSession(target.agentId, {
              engine: this._engine,
              conversationId: target.conversationId,
              conversationType: target.conversationType,
              now,
              reason: target.reason,
            });
            result.phoneCompacted += 1;
          } catch (err) {
            result.failed += 1;
            result.staleRemaining += 1;
            console.warn(`[fresh-compact] phone ${target.agentId}/${target.conversationId} skipped: ${err?.message || err}`);
          }
          await sleep(this._delayBetweenJobsMs);
        }
      }
      return result;
    } finally {
      this._running = false;
    }
  }
}
