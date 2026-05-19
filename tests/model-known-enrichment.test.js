import { describe, expect, it } from "vitest";
import { enrichModelFromKnownMetadata } from "../core/model-known-enrichment.js";

describe("enrichModelFromKnownMetadata", () => {
  it("adds Hana metadata to Pi built-in Kimi models without dropping request headers", () => {
    const model = {
      id: "kimi-for-coding",
      name: "Kimi For Coding",
      api: "anthropic-messages",
      provider: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      headers: { "User-Agent": "KimiCLI/1.5" },
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 262144,
      maxTokens: 32768,
    };

    const enriched = enrichModelFromKnownMetadata(model);

    expect(enriched.headers).toEqual({ "User-Agent": "KimiCLI/1.5" });
    expect(enriched.visionCapabilities).toMatchObject({
      grounding: true,
      outputFormat: "anchor",
    });
    expect(enriched.compat).toMatchObject({
      supportsDeveloperRole: false,
      thinkingFormat: "anthropic",
    });
  });
});
