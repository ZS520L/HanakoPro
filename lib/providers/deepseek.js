/**
 * DeepSeek provider plugin
 */

/** @type {import('../provider-registry.js').ProviderPlugin} */
export const deepseekPlugin = {
  id: "deepseek",
  displayName: "DeepSeek",
  authType: "api-key",
  defaultBaseUrl: "https://api.deepseek.com",
  defaultApi: "openai-completions",
};
