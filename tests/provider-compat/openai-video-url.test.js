import { describe, expect, it } from "vitest";

import { normalizeProviderPayload } from "../../core/provider-compat.js";

describe("provider-compat/openai-video-url", () => {
  it("converts Moonshot Kimi data:video image_url blocks to video_url", () => {
    const payload = {
      model: "kimi-k2.6",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:video/mp4;base64,AAAA" } },
          { type: "text", text: "看一下" },
        ],
      }],
    };

    const result = normalizeProviderPayload(payload, {
      id: "kimi-k2.6",
      provider: "moonshot",
      api: "openai-completions",
      input: ["text", "image"],
      compat: { hanaVideoInput: true },
      baseUrl: "https://api.moonshot.cn/v1",
    }, { mode: "chat" });

    expect(result).not.toBe(payload);
    expect(result.messages[0].content[0]).toEqual({
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,AAAA" },
    });
    expect(payload.messages[0].content[0].type).toBe("image_url");
  });

  it("also accepts SDK/client camelCase imageUrl blocks", () => {
    const payload = {
      model: "qwen3-vl-plus",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", imageUrl: { url: "data:video/webm;base64,BBBB" } },
        ],
      }],
    };

    const result = normalizeProviderPayload(payload, {
      id: "qwen3-vl-plus",
      provider: "dashscope",
      api: "openai-completions",
      input: ["text", "image"],
      compat: { hanaVideoInput: true },
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }, { mode: "chat" });

    expect(result.messages[0].content[0]).toEqual({
      type: "video_url",
      video_url: { url: "data:video/webm;base64,BBBB" },
    });
  });
});
