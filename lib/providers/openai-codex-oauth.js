/**
 * OpenAI Codex OAuth provider plugin
 *
 * 通过 OAuth 接入，对应 auth.json 中的 openai-codex 条目。
 */

/** @type {import('../provider-registry.js').ProviderPlugin} */
export const openaiCodexOAuthPlugin = {
  id: "openai-codex-oauth",
  displayName: "OpenAI Codex (OAuth)",
  authType: "oauth",
  defaultBaseUrl: "https://chatgpt.com/backend-api",
  defaultApi: "openai-codex-responses",
  authJsonKey: "openai-codex",
  capabilities: {
    chat: {
      runtimeProviderId: "openai-codex",
      displayProviderId: "openai-codex",
      projection: "sdk-auth-alias",
      allowListSource: "provider.models",
    },
    media: {
      imageGeneration: {
        defaultModelId: "gpt-image-2",
        credentialLanes: [
          {
            id: "codex-oauth",
            providerId: "openai-codex-oauth",
            authJsonKey: "openai-codex",
            label: "Codex OAuth",
          },
        ],
        models: [
          {
            id: "gpt-image-2",
            displayName: "GPT Image 2",
            protocolId: "openai-codex-responses-image",
            credentialLaneId: "codex-oauth",
            inputs: ["text", "image"],
            outputs: ["image"],
            supportsEdit: true,
            aliases: ["2", "image-2"],
          },
        ],
      },
    },
  },
};
