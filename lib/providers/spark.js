/** @type {import('../../core/provider-registry.js').ProviderPlugin} */
export const sparkPlugin = {
  id: "spark",
  displayName: "讯飞星火 (Spark)",
  authType: "api-key",
  defaultBaseUrl: "https://spark-api-open.xf-yun.com/v1",
  defaultApi: "openai-completions",
};
