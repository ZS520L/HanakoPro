/**
 * Volcengine (火山引擎 / 豆包) provider plugin
 *
 * 注意：火山引擎的 model ID 实际是用户在控制台创建的 endpoint ID（如 ep-xxxxxx），
 * 不是标准模型名，故无默认模型列表，用户需通过设置页手动配置。
 *
 * 文档：https://www.volcengine.com/docs/82379/1399008
 */

/** @type {import('../../core/provider-registry.js').ProviderPlugin} */
export const volcenginePlugin = {
  id: "volcengine",
  displayName: "火山引擎 (豆包)",
  authType: "api-key",
  defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  defaultApi: "openai-completions",
  capabilities: {
    media: {
      imageGeneration: {
        defaultModelId: "doubao-seedream-5-0-lite-260128",
        credentialLanes: [
          {
            id: "volcengine",
            providerId: "volcengine",
            label: "火山引擎 API Key",
          },
          {
            id: "volcengine-coding",
            providerId: "volcengine-coding",
            label: "火山引擎 Coding Plan",
          },
        ],
        models: [
          { id: "doubao-seedream-3-0-t2i", displayName: "Seedream 3.0", protocolId: "volcengine-images", inputs: ["text"], outputs: ["image"], aliases: ["3.0"] },
          { id: "doubao-seedream-4-0-250828", displayName: "Seedream 4.0", protocolId: "volcengine-images", inputs: ["text", "image"], outputs: ["image"], aliases: ["4.0"] },
          { id: "doubao-seedream-4-5-251128", displayName: "Seedream 4.5", protocolId: "volcengine-images", inputs: ["text", "image"], outputs: ["image"], aliases: ["4.5"] },
          { id: "doubao-seedream-5-0-lite-260128", displayName: "Seedream 5.0 Lite", protocolId: "volcengine-images", inputs: ["text", "image"], outputs: ["image"], aliases: ["5.0", "5.0-lite"] },
        ],
      },
    },
  },
};
