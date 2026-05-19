/**
 * Google Gemini provider plugin
 *
 * 通过 Gemini native API 接入。Gemini 3 工具调用需要保留
 * thoughtSignature，Pi SDK 的 google-generative-ai provider 已处理该协议。
 * 文档：https://ai.google.dev/gemini-api/docs
 */

/** @type {import('../provider-registry.js').ProviderPlugin} */
export const geminiPlugin = {
  id: "gemini",
  displayName: "Google Gemini",
  authType: "api-key",
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  defaultApi: "google-generative-ai",
};
