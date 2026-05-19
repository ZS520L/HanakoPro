import { describe, expect, it } from "vitest";
import { normalizeProviderPayload } from "../core/provider-compat.js";

// 这套测试断言 qwen utility 路径的端到端集成：
// llm-client.js 的 callText 把 quirks 合入 model 后传给 normalizeProviderPayload，
// dispatcher 找到 qwen 子模块，apply 注入 enable_thinking: false。
describe("Qwen utility 路径端到端：quirks 合入 model 后被 qwen.js 识别", () => {
  it("dashscope provider + quirks 含 enable_thinking + utility mode → enable_thinking: false", () => {
    const payload = {
      model: "qwen3.5-plus",
      messages: [{ role: "user", content: "hi" }],
    };
    const model = {
      id: "qwen3.5-plus",
      provider: "dashscope",
      reasoning: true,
      quirks: ["enable_thinking"],
    };
    const result = normalizeProviderPayload(payload, model, { mode: "utility" });
    expect(result.enable_thinking).toBe(false);
  });

  it("dashscope 但 quirks 不含 enable_thinking → 不动", () => {
    const payload = {
      model: "qwen-plus",
      messages: [{ role: "user", content: "hi" }],
    };
    const model = {
      id: "qwen-plus",
      provider: "dashscope",
      quirks: [],
    };
    const result = normalizeProviderPayload(payload, model, { mode: "utility" });
    expect(Object.prototype.hasOwnProperty.call(result, "enable_thinking")).toBe(false);
  });

  it("dashscope 模型即使 chat mode 也不被 qwen 子模块改（chat 让 Pi SDK 处理）", () => {
    const payload = {
      model: "qwen3.5-plus",
      messages: [{ role: "user", content: "hi" }],
    };
    const model = {
      id: "qwen3.5-plus",
      provider: "dashscope",
      reasoning: true,
      quirks: ["enable_thinking"],
    };
    const result = normalizeProviderPayload(payload, model, { mode: "chat" });
    expect(Object.prototype.hasOwnProperty.call(result, "enable_thinking")).toBe(false);
  });

  it("siliconflow + Qwen 思考模型 + utility mode → enable_thinking: false（覆盖原本被遗漏的 16 个模型）", () => {
    const payload = {
      model: "qwen3-plus",
      messages: [{ role: "user", content: "hi" }],
    };
    const model = {
      id: "qwen3-plus",
      provider: "siliconflow",
      reasoning: true,
      quirks: ["enable_thinking"],
    };
    const result = normalizeProviderPayload(payload, model, { mode: "utility" });
    expect(result.enable_thinking).toBe(false);
  });
});
