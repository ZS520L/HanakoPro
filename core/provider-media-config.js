import fs from "fs";
import path from "path";
import YAML from "js-yaml";
import { safeReadYAMLSync } from "../shared/safe-fs.js";
import { lookupKnown } from "../shared/known-models.js";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function modelId(model) {
  return isPlainObject(model) ? model.id : model;
}

function modelType(providerId, model) {
  if (!isPlainObject(model)) return lookupKnown(providerId, model)?.type || "chat";
  return model.type || lookupKnown(providerId, model.id)?.type || "chat";
}

function normalizeMediaModelEntry(model) {
  if (!isPlainObject(model)) return null;
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id) return null;
  const { type: _type, display_name: displayName, ...rest } = model;
  const next = { ...rest, id };
  if (displayName !== undefined && next.displayName === undefined && next.name === undefined) {
    next.name = displayName;
  }
  return next;
}

function appendUniqueMediaModels(existing, additions) {
  const result = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(result.map(modelId).filter(Boolean));
  let changed = false;
  for (const model of additions) {
    const id = modelId(model);
    if (!id || seen.has(id)) continue;
    result.push(model);
    seen.add(id);
    changed = true;
  }
  return { models: result, changed };
}

export function normalizeProviderMediaConfigMap(rawProviders) {
  if (!isPlainObject(rawProviders)) return { providers: {}, changed: false };
  const providers = {};
  let changed = false;

  for (const [providerId, config] of Object.entries(rawProviders)) {
    if (!isPlainObject(config)) {
      providers[providerId] = config;
      continue;
    }
    const next = { ...config };
    const models = Array.isArray(config.models) ? config.models : [];
    const chatModels = [];
    const imageModels = [];

    for (const model of models) {
      if (modelType(providerId, model) === "image") {
        const mediaModel = normalizeMediaModelEntry(model);
        if (mediaModel) imageModels.push(mediaModel);
        changed = true;
      } else {
        chatModels.push(model);
      }
    }

    if (imageModels.length > 0) {
      next.models = chatModels;
      const media = isPlainObject(next.media) ? { ...next.media } : {};
      const imageGeneration = isPlainObject(media.image_generation) ? { ...media.image_generation } : {};
      const appended = appendUniqueMediaModels(imageGeneration.models, imageModels);
      imageGeneration.models = appended.models;
      media.image_generation = imageGeneration;
      next.media = media;
      changed = changed || appended.changed;
    }

    providers[providerId] = next;
  }

  return { providers, changed };
}

export function migrateProviderMediaConfig(hanakoHome, log = () => {}) {
  const ymlPath = path.join(hanakoHome, "added-models.yaml");
  const existing = safeReadYAMLSync(ymlPath, null, YAML);
  if (!existing || !isPlainObject(existing.providers)) return false;

  const { providers, changed } = normalizeProviderMediaConfigMap(existing.providers);
  if (!changed) return false;

  const header =
    "# Hanako 供应商配置（全局，跨 agent 共享）\n" +
    "# 由设置页面管理\n\n";
  const data = { ...existing, providers };
  const yamlStr = header + YAML.dump(data, {
    indent: 2,
    lineWidth: -1,
    sortKeys: false,
    quotingType: "\"",
    forceQuotes: false,
  });
  const tmpPath = `${ymlPath}.tmp`;
  fs.writeFileSync(tmpPath, yamlStr, "utf-8");
  fs.renameSync(tmpPath, ymlPath);
  log("[migrate] provider image models migrated to media.image_generation");
  return true;
}
