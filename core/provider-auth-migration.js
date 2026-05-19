import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { safeReadYAMLSync } from "../shared/safe-fs.js";
import { getInvalidProviderModelIds } from "../shared/provider-model-validation.js";
import { providerCredentialAllowsMissingApiKey } from "../shared/provider-auth.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) || {};
  } catch {
    return {};
  }
}

function writeProvidersYaml(filePath, raw, providers) {
  const header =
    "# Hanako 供应商配置（全局，跨 agent 共享）\n" +
    "# 由设置页面管理\n\n";
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(
    tmpPath,
    header + YAML.dump({ ...raw, providers }, {
      indent: 2,
      lineWidth: -1,
      sortKeys: false,
      quotingType: "\"",
      forceQuotes: false,
    }),
    "utf-8",
  );
  fs.renameSync(tmpPath, filePath);
}

function extractLegacyApiKey(credential) {
  if (typeof credential === "string") return credential.trim();
  if (!isPlainObject(credential)) return "";
  if (credential.type === "oauth") return "";
  if (credential.type && credential.type !== "api_key") return "";
  return String(
    credential.key
      || credential.apiKey
      || (credential.type === "api_key" ? credential.access : "")
      || (credential.type === "api_key" ? credential.token : "")
      || "",
  ).trim();
}

function extractProjectedApiKey(providerConfig) {
  if (!isPlainObject(providerConfig)) return "";
  return String(providerConfig.apiKey || providerConfig.api_key || "").trim();
}

function isSyntheticLocalApiKey(apiKey, entry, providerConfig) {
  if (apiKey !== "local") return false;
  return providerCredentialAllowsMissingApiKey({
    authType: entry?.authType,
    baseUrl: providerConfig?.baseUrl || entry?.baseUrl || "",
  });
}

function getLegacyApiKey(auth, providerId, providerKey, authJsonKey) {
  if (!isPlainObject(auth)) return "";
  const keys = [...new Set([providerKey, authJsonKey, providerId].filter(Boolean))];
  for (const key of keys) {
    if (!hasOwn(auth, key)) continue;
    const apiKey = extractLegacyApiKey(auth[key]);
    if (apiKey) return apiKey;
  }
  return "";
}

function resolveProviderEntry(providerRegistry, authKey) {
  try {
    return providerRegistry?.get?.(authKey) || null;
  } catch {
    return null;
  }
}

function getModelsJsonProvider(modelsProviders, providerId, authKey, authJsonKey) {
  if (!isPlainObject(modelsProviders)) return null;
  return modelsProviders[providerId]
    || modelsProviders[authKey]
    || (authJsonKey ? modelsProviders[authJsonKey] : null)
    || null;
}

function modelIdsFromModelsJsonProvider(providerConfig) {
  const ids = [];
  if (Array.isArray(providerConfig?.models)) {
    for (const model of providerConfig.models) {
      const id = typeof model === "string" ? model : model?.id;
      if (typeof id === "string" && id.trim()) ids.push(id.trim());
    }
  }
  if (isPlainObject(providerConfig?.modelOverrides)) {
    ids.push(...Object.keys(providerConfig.modelOverrides).filter(Boolean));
  }
  return [...new Set(ids)];
}

function defaultModels(providerRegistry, providerId) {
  try {
    const models = providerRegistry?.getDefaultModels?.(providerId);
    return Array.isArray(models) ? models.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function filterInvalidProviderModels(providerId, models, baseUrl) {
  if (!models.length) return models;
  const invalid = new Set(
    getInvalidProviderModelIds(providerId, models, { baseUrl })
      .map((id) => String(id).trim().toLowerCase()),
  );
  if (invalid.size === 0) return models;
  return models.filter((id) => !invalid.has(String(id).trim().toLowerCase()));
}

/**
 * API-key provider 的运行时真相源已收敛为 added-models.yaml。
 * 旧版本可能仍把 key 存在 Pi SDK auth.json；在清理 auth.json 前必须先搬迁，
 * 否则一次 provider 同步就会把用户唯一的 API key 删掉。
 * 已经被问题版本清理过 auth.json 的用户，如果 models.json 里仍保留着上次投影的
 * apiKey，也会在下一次同步覆盖 models.json 前抢救回来。
 *
 * 迁移只填补缺失的 api_key：
 * - 不覆盖 added-models.yaml 中已有的 api_key，即使它是空字符串；
 * - 不迁移 OAuth token；
 * - 凭证来源优先级为 added-models.yaml 显式值 > models.json 投影值 > auth.json 旧值；
 * - 尽量从 provider 插件或旧 models.json 回填 base_url/api/models，帮助旧配置自愈。
 */
export function migrateLegacyApiKeyAuthToProviders({ hanakoHome, providerRegistry, log = () => {} }) {
  if (!hanakoHome) return { migrated: 0, providers: [] };

  const authPath = path.join(hanakoHome, "auth.json");
  const providersPath = path.join(hanakoHome, "added-models.yaml");
  const auth = readJson(authPath);

  providerRegistry?.reload?.();
  const raw = safeReadYAMLSync(providersPath, {}, YAML) || {};
  const providers = isPlainObject(raw.providers) ? { ...raw.providers } : {};
  const modelsJsonProvidersRaw = readJson(path.join(hanakoHome, "models.json")).providers || {};
  const modelsJsonProviders = isPlainObject(modelsJsonProvidersRaw) ? modelsJsonProvidersRaw : {};
  const providerKeys = new Set([
    ...(isPlainObject(auth) ? Object.keys(auth) : []),
    ...Object.keys(modelsJsonProviders),
  ]);
  if (providerKeys.size === 0) {
    return { migrated: 0, providers: [] };
  }

  const migratedProviders = [];

  for (const providerKey of providerKeys) {
    const entry = resolveProviderEntry(providerRegistry, providerKey);
    if (entry?.authType === "oauth") continue;

    const providerId = entry?.id || providerKey;
    const current = isPlainObject(providers[providerId]) ? providers[providerId] : {};
    if (hasOwn(current, "api_key")) continue;

    const modelsJsonProvider = getModelsJsonProvider(
      modelsJsonProviders,
      providerId,
      providerKey,
      entry?.authJsonKey,
    );
    const projectedApiKey = extractProjectedApiKey(modelsJsonProvider);
    const apiKey = (
      projectedApiKey && !isSyntheticLocalApiKey(projectedApiKey, entry, modelsJsonProvider)
        ? projectedApiKey
        : ""
    ) || getLegacyApiKey(auth, providerId, providerKey, entry?.authJsonKey);
    if (!apiKey) continue;

    const next = { ...current, api_key: apiKey };

    const baseUrl = current.base_url || modelsJsonProvider?.baseUrl || entry?.baseUrl || "";
    if (baseUrl && !hasOwn(current, "base_url")) next.base_url = baseUrl;

    const api = current.api || modelsJsonProvider?.api || entry?.api || "";
    if (api && !hasOwn(current, "api")) next.api = api;

    if (!hasOwn(current, "models") || !Array.isArray(current.models)) {
      const modelIds = modelIdsFromModelsJsonProvider(modelsJsonProvider);
      const seededModels = modelIds.length > 0 ? modelIds : defaultModels(providerRegistry, providerId);
      const validModels = filterInvalidProviderModels(providerId, seededModels, baseUrl);
      if (validModels.length > 0) next.models = validModels;
    }

    providers[providerId] = next;
    migratedProviders.push(providerId);
  }

  if (migratedProviders.length === 0) {
    return { migrated: 0, providers: [] };
  }

  fs.mkdirSync(path.dirname(providersPath), { recursive: true });
  writeProvidersYaml(providersPath, raw, providers);
  providerRegistry?.reload?.();
  log(`[migrations] legacy API-key auth moved to added-models.yaml (${migratedProviders.join(", ")})`);
  return { migrated: migratedProviders.length, providers: migratedProviders };
}
