import { describe, expect, it } from "vitest";
import {
  buildBridgeContext,
  buildBridgePromptLine,
  normalizeBridgePlatforms,
} from "../lib/bridge/bridge-context.js";

describe("bridge context", () => {
  it("formats a low-salience Chinese platform line", () => {
    const context = buildBridgeContext({
      sessionKey: "wx_dm_owner@hana",
      role: "owner",
    });

    expect(buildBridgePromptLine(context, "zh")).toBe(
      "当前用户正通过微信与你对话，仅在需要理解当前平台或“这里”等指代时参考。",
    );
  });

  it("builds owner notification hints for Bridge DM sessions", () => {
    const context = buildBridgeContext({
      sessionKey: "wx_dm_wx-user@hana",
      role: "owner",
      userId: "wx-user",
      chatId: "wx-user",
      agentId: "hana",
    }, "zh");

    expect(context).toMatchObject({
      isBridgeSession: true,
      platform: "wechat",
      platformLabel: "微信",
      chatType: "dm",
      role: "owner",
      sessionKey: "wx_dm_wx-user@hana",
      agentId: "hana",
      userId: "wx-user",
      chatId: "wx-user",
      notificationHint: {
        channels: ["bridge_owner"],
        bridgePlatforms: ["wechat"],
        contextPolicy: "record_when_delivered",
      },
    });
  });

  it("does not turn guest chats into owner notification targets", () => {
    const context = buildBridgeContext({
      sessionKey: "tg_group_g1@hana",
      role: "guest",
      userId: "guest-user",
      chatId: "g1",
      agentId: "hana",
    }, "zh");

    expect(context).toMatchObject({
      isBridgeSession: true,
      platform: "telegram",
      chatType: "group",
      role: "guest",
      notificationHint: null,
    });
  });

  it("normalizes Bridge platform preferences", () => {
    expect(normalizeBridgePlatforms(["wechat", "wechat", "feishu", "sms"])).toEqual({
      bridgePlatforms: ["wechat", "feishu"],
      invalidBridgePlatforms: ["sms"],
    });
  });
});
