import { describe, expect, it } from "vitest";
import { normalizeProviderMediaConfigMap } from "../core/provider-media-config.js";

describe("provider media config migration", () => {
  it("moves legacy image model entries out of chat models into media.image_generation", () => {
    const { providers, changed } = normalizeProviderMediaConfigMap({
      "openai-codex-oauth": {
        models: [
          "gpt-5.4",
          "gpt-5.5",
          { id: "gpt-image-2", type: "image", name: "GPT Image 2" },
        ],
      },
    });

    expect(changed).toBe(true);
    expect(providers["openai-codex-oauth"].models).toEqual(["gpt-5.4", "gpt-5.5"]);
    expect(providers["openai-codex-oauth"].media.image_generation.models).toEqual([
      { id: "gpt-image-2", name: "GPT Image 2" },
    ]);
  });

  it("is idempotent when media models already use the new shape", () => {
    const input = {
      openai: {
        models: ["gpt-5.5"],
        media: {
          image_generation: {
            models: [{ id: "gpt-image-2", name: "GPT Image 2" }],
          },
        },
      },
    };

    const { providers, changed } = normalizeProviderMediaConfigMap(input);

    expect(changed).toBe(false);
    expect(providers).toEqual(input);
  });
});
