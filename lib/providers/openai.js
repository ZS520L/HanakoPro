/**
 * OpenAI provider plugin
 */

/** @type {import('../provider-registry.js').ProviderPlugin} */
export const openaiPlugin = {
  id: "openai",
  displayName: "OpenAI",
  authType: "api-key",
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultApi: "openai-completions",
  capabilities: {
    media: {
      imageGeneration: {
        defaultModelId: "gpt-image-2",
        models: [
          { id: "gpt-image-2", displayName: "GPT Image 2", protocolId: "openai-images", inputs: ["text", "image"], outputs: ["image"], supportsEdit: true, aliases: ["2"] },
          { id: "gpt-image-1", displayName: "GPT Image 1", protocolId: "openai-images", inputs: ["text", "image"], outputs: ["image"], supportsEdit: true, aliases: ["1"] },
          { id: "gpt-image-1.5", displayName: "GPT Image 1.5", protocolId: "openai-images", inputs: ["text", "image"], outputs: ["image"], supportsEdit: true, aliases: ["1.5"] },
          { id: "gpt-image-1-mini", displayName: "GPT Image 1 Mini", protocolId: "openai-images", inputs: ["text", "image"], outputs: ["image"], supportsEdit: true, aliases: ["1-mini", "mini"] },
          { id: "dall-e-3", displayName: "DALL-E 3", protocolId: "openai-images", inputs: ["text"], outputs: ["image"], aliases: ["dalle3"] },
        ],
      },
    },
  },
};
