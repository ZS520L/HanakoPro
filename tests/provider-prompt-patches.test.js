import { describe, expect, it } from "vitest";
import { getProviderPromptPatches } from "../core/provider-prompt-patches.js";

describe("provider prompt patches — DeepSeek output contract", () => {
  it("adds the DeepSeek patch for official DeepSeek reasoning models", () => {
    const patches = getProviderPromptPatches({
      id: "deepseek-v4-pro",
      provider: "deepseek",
      reasoning: true,
    }, { reasoningLevel: "high", locale: "zh-CN" });

    expect(patches.join("\n")).toContain("如果你使用的是 DeepSeek 模型");
    expect(patches.join("\n")).toContain("DeepSeek 输出契约");
  });

  it("adds the DeepSeek patch for DeepSeek family models hosted by other providers", () => {
    const patches = getProviderPromptPatches({
      id: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      reasoning: true,
    }, { reasoningLevel: "high", locale: "zh-CN" });

    expect(patches.join("\n")).toContain("DeepSeek 输出契约");
  });

  it("adds the DeepSeek patch for deepseek-ai model ids even when provider is not DeepSeek", () => {
    const patches = getProviderPromptPatches({
      id: "deepseek-ai/DeepSeek-R1",
      provider: "siliconflow",
      reasoning: true,
    }, { reasoningLevel: "medium", locale: "zh-CN" });

    expect(patches.join("\n")).toContain("DeepSeek 输出契约");
  });

  it("does not add the patch when thinking is off", () => {
    const patches = getProviderPromptPatches({
      id: "deepseek-v4-pro",
      provider: "deepseek",
      reasoning: true,
    }, { reasoningLevel: "off", locale: "zh-CN" });

    expect(patches).toEqual([]);
  });

  it("does not add the patch for non-DeepSeek reasoning models", () => {
    const patches = getProviderPromptPatches({
      id: "kimi-k2.6",
      provider: "kimi-coding",
      reasoning: true,
      compat: { thinkingFormat: "anthropic" },
    }, { reasoningLevel: "high", locale: "zh-CN" });

    expect(patches).toEqual([]);
  });

  it("does not include the removed restatement sentence", () => {
    const patches = getProviderPromptPatches({
      id: "deepseek-v4-pro",
      provider: "deepseek",
      reasoning: true,
    }, { reasoningLevel: "high", locale: "zh-CN" });

    expect(patches.join("\n")).not.toContain("如果你已经在 reasoning_content / thinking 中写出了可展示内容");
  });
});
