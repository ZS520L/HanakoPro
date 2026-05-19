/**
 * Provider auth policy helpers.
 *
 * 认证需求属于 provider 契约，不属于 URL 形态。loopback 无 key 放行
 * 只作为历史兼容规则保留，避免旧本地服务配置突然不可用。
 */
import { isLocalBaseUrl } from "./net-utils.js";

const AUTH_TYPES_ALLOWING_MISSING_API_KEY = new Set(["none", "optional"]);
const KNOWN_AUTH_TYPES = new Set(["api-key", "oauth", "none", "optional"]);

export function normalizeProviderAuthType(authType) {
  return KNOWN_AUTH_TYPES.has(authType) ? authType : "api-key";
}

export function providerAuthTypeAllowsMissingApiKey(authType) {
  return AUTH_TYPES_ALLOWING_MISSING_API_KEY.has(normalizeProviderAuthType(authType));
}

export function providerCredentialAllowsMissingApiKey({ authType, baseUrl } = {}) {
  return providerAuthTypeAllowsMissingApiKey(authType) || isLocalBaseUrl(baseUrl);
}
