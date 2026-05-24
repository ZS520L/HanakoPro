import { describe, expect, it } from "vitest";
import { normalizeProviderPayload } from "../../core/provider-compat.js";
import * as spark from "../../core/provider-compat/spark.js";

describe("provider-compat/spark — matches", () => {
  it("matches 对 null/undefined 返回 false（不抛错）", () => {
    expect(spark.matches(null)).toBe(false);
    expect(spark.matches(undefined)).toBe(false);
    expect(spark.matches({})).toBe(false);
  });

  it("matches 识别 spark provider", () => {
    expect(spark.matches({ provider: "spark" })).toBe(true);
  });

  it("matches 识别讯飞星火 OpenAI-compatible baseUrl", () => {
    expect(spark.matches({ baseUrl: "https://spark-api-open.xf-yun.com/v1" })).toBe(true);
    expect(spark.matches({ base_url: "https://spark-api-open.xf-yun.com/v1" })).toBe(true);
  });

  it("matches 不把普通 OpenAI-compatible provider 视为 spark", () => {
    expect(spark.matches({ provider: "openai", baseUrl: "https://api.openai.com/v1" })).toBe(false);
  });
});

describe("provider-compat/spark — apply", () => {
  it("把 OpenAI-style content 数组转换为字符串且不改写模型名", () => {
    const payload = {
      model: "4.0Ultra",
      messages: [
        { role: "system", content: [{ type: "text", text: "system prompt" }] },
        {
          role: "user",
          content: [
            { type: "text", text: "第一段" },
            { type: "text", text: "第二段" },
            { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
          ],
        },
        { role: "assistant", content: "ok" },
      ],
    };

    const result = spark.apply(payload, { provider: "spark" }, { mode: "chat" });

    expect(result).not.toBe(payload);
    expect(result.model).toBe("4.0Ultra");
    expect(result.messages[0].content).toBe("system prompt");
    expect(result.messages[1].content).toBe("第一段\n第二段");
    expect(result.messages[2]).toBe(payload.messages[2]);
    expect(Array.isArray(payload.messages[0].content)).toBe(true);
    expect(Array.isArray(payload.messages[1].content)).toBe(true);
  });

  it("字符串 content 已兼容时返回原 payload 引用", () => {
    const payload = {
      model: "generalv3.5",
      messages: [{ role: "user", content: "hi" }],
    };

    expect(spark.apply(payload, { provider: "spark" }, { mode: "chat" })).toBe(payload);
  });

  it("dispatcher 在 chat 和 utility 路径都应用 Spark content 兼容", () => {
    const model = {
      id: "generalv3.5",
      provider: "spark",
      api: "openai-completions",
      baseUrl: "https://spark-api-open.xf-yun.com/v1",
    };
    const payload = {
      model: "generalv3.5",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };

    const chatResult = normalizeProviderPayload(payload, model, { mode: "chat" });
    const utilityResult = normalizeProviderPayload(payload, model, { mode: "utility" });

    expect(chatResult.messages[0].content).toBe("hi");
    expect(utilityResult.messages[0].content).toBe("hi");
    expect(payload.messages[0].content).toEqual([{ type: "text", text: "hi" }]);
  });
});
