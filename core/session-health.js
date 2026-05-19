/**
 * Session 健康度评估（#521）
 *
 * 上游 provider 的 empty_stream / context overflow 等失败会被 Pi SDK 持久化为
 * `stopReason: "error"` 的 assistant message。当用户重新打开这条会话时，会话本
 * 身的真实业务上下文已经撑爆 model context window，每次发消息都立即失败 →
 * 反复写入新的 error → 桌面端体感"卡死"。
 *
 * 这里提供一个轻量的 jsonl 尾扫描器，让 restore 调用方在恢复前先评估会话是否
 * 在持续报错，从而决定是否提示用户、跳过自动 restore 或触发更激进的兜底逻辑。
 *
 * 设计要点：
 * - 纯函数 + 同步 IO，方便单元测试
 * - 只看 trailing N 条 assistant message，O(N) 不依赖整个 jsonl 大小
 * - 不存在 / 解析错误 → 一律视为 healthy（容错优先，绝不阻塞合法会话）
 */
import fs from "fs";

const DEFAULT_LOOKBACK = 10;
const DEFAULT_ERROR_THRESHOLD = 3;

/**
 * @param {string} sessionPath - absolute path to the session .jsonl
 * @param {object} [opts]
 * @param {number} [opts.lookback=10] - 检查最后多少条 assistant message
 * @param {number} [opts.errorThreshold=3] - >= 此值视为 unhealthy
 * @returns {{ healthy: boolean, recentErrors: number, totalChecked: number, exists: boolean }}
 */
export function evaluateSessionHealth(sessionPath, opts = {}) {
  const lookback = opts.lookback ?? DEFAULT_LOOKBACK;
  const errorThreshold = opts.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;

  let raw;
  try {
    raw = fs.readFileSync(sessionPath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { healthy: true, recentErrors: 0, totalChecked: 0, exists: false };
    }
    // 其它 IO 错误：保守视为 healthy，把决定权交回上层（不要因为权限问题阻断 restore）
    return { healthy: true, recentErrors: 0, totalChecked: 0, exists: false };
  }

  const lines = raw.split("\n");
  let assistantCount = 0;
  let errorCount = 0;
  for (let i = lines.length - 1; i >= 0 && assistantCount < lookback; i--) {
    const line = lines[i];
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message") continue;
    if (entry?.message?.role !== "assistant") continue;
    assistantCount++;
    if (entry.message.stopReason === "error") errorCount++;
  }

  return {
    healthy: errorCount < errorThreshold,
    recentErrors: errorCount,
    totalChecked: assistantCount,
    exists: true,
  };
}
