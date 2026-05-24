/**
 * notify-tool.js — 用户通知工具
 *
 * 让 agent 能主动向用户发送提醒，由通知投递层决定桌面 / Bridge 等通道。
 * 仅在用户明确要求提醒/通知时使用，普通任务完成不调用。
 */

import { Type, StringEnum } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";

/**
 * @param {{ onNotify: (payload: object) => Promise<object|void> | object | void }} opts
 */
export function createNotifyTool({ onNotify }) {
  return {
    name: "notify",
    label: t("toolDef.notify.label"),
    description: t("toolDef.notify.description"),
    parameters: Type.Object({
      title: Type.String({ description: t("toolDef.notify.titleDesc") }),
      body: Type.String({ description: t("toolDef.notify.bodyDesc") }),
      audience: Type.Optional(StringEnum(["owner"], {
        description: "Notification audience. Use owner for the human user.",
      })),
      channels: Type.Optional(Type.Array(StringEnum(["auto", "desktop", "bridge_owner"], {
        description: "Delivery channels. Use desktop for local popup, bridge_owner for the owner's Bridge chat, or auto for default routing.",
      }), {
        description: "Preferred delivery channels. Do not include a channel unless the user asked for it or the task prompt implies it.",
      })),
      bridgePlatforms: Type.Optional(Type.Array(StringEnum(["wechat", "feishu", "telegram", "qq"], {
        description: "Preferred Bridge platforms when channels includes bridge_owner. Use this to pin delivery to the current Bridge platform, e.g. wechat or feishu.",
      }), {
        description: "Ordered Bridge platform preferences. If set, Bridge owner notifications are sent only through these platforms in order.",
      })),
      contextPolicy: Type.Optional(StringEnum(["none", "record_when_delivered"], {
        description: "Whether a successfully delivered Bridge notification should be appended to the Bridge conversation context.",
      })),
    }),
    execute: async (_toolCallId, params) => {
      const { title, body } = params;
      try {
        const result = await onNotify?.({
          title,
          body,
          audience: params.audience,
          channels: params.channels,
          bridgePlatforms: params.bridgePlatforms,
          contextPolicy: params.contextPolicy,
        });
        const sent = result?.ok !== false;
        const failure = Array.isArray(result?.deliveries)
          ? result.deliveries.find((d) => d?.status === "failed")?.error
          : null;
        return {
          content: [{
            type: "text",
            text: sent
              ? t("error.notifySent", { title })
              : t("error.notifyFailed", { msg: failure || "delivery failed" }),
          }],
          details: { title, body, sent, result },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: t("error.notifyFailed", { msg: err.message }) }],
          details: { title, body, sent: false, error: err.message },
        };
      }
    },
  };
}
