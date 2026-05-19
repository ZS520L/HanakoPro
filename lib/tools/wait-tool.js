/**
 * wait-tool.js — 等待指定秒数
 *
 * 让 agent 在等待后台任务（subagent、图像生成等）时
 * 能主动"等一会"再继续。工具执行期间 turn 保持活跃，UI 不阻塞。
 */

import { Type } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";
import { MAX_WAIT_SECONDS, normalizeWaitSeconds } from "./wait-contract.js";

export function createWaitTool() {
  return {
    name: "wait",
    label: t("toolDef.wait.label"),
    description: t("toolDef.wait.description"),
    parameters: Type.Object({
      seconds: Type.Number({
        description: t("toolDef.wait.secondsDesc"),
        minimum: 1,
        maximum: MAX_WAIT_SECONDS,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const seconds = normalizeWaitSeconds(params.seconds);
      await new Promise(r => setTimeout(r, seconds * 1000));
      return {
        content: [{ type: "text", text: `${seconds}s` }],
        details: { seconds, durationMs: seconds * 1000 },
      };
    },
  };
}
