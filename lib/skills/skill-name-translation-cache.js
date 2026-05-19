import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const CACHE_VERSION = 1;

function emptyCache() {
  return {
    version: CACHE_VERSION,
    translations: {},
  };
}

export function getSkillNameTranslationCachePath(hanakoHome) {
  return path.join(hanakoHome, ".ephemeral", "skill-name-translations.json");
}

function normalizeCache(value) {
  if (!value || typeof value !== "object") return emptyCache();
  const translations = value.translations && typeof value.translations === "object"
    ? value.translations
    : {};
  return {
    version: CACHE_VERSION,
    translations,
  };
}

function readCache(cachePath) {
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    return normalizeCache(JSON.parse(raw));
  } catch (err) {
    if (err?.code === "ENOENT") return emptyCache();
    throw err;
  }
}

function writeCache(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmpPath = `${cachePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalizeCache(cache), null, 2) + os.EOL, "utf-8");
  fs.renameSync(tmpPath, cachePath);
}

export function fingerprintSkill(skill) {
  if (!skill || typeof skill.name !== "string" || !skill.name.trim()) return null;
  if (typeof skill.filePath === "string" && skill.filePath) {
    try {
      const stat = fs.statSync(skill.filePath);
      if (stat.isFile()) {
        return createHash("sha256")
          .update("skill-file\0")
          .update(fs.readFileSync(skill.filePath))
          .digest("hex");
      }
    } catch {
      return null;
    }
  }
  return createHash("sha256")
    .update("skill-meta\0")
    .update(JSON.stringify({
      name: skill.name,
      description: skill.description || "",
      source: skill.source || "",
    }))
    .digest("hex");
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function indexSkillsByName(skills) {
  const byName = new Map();
  for (const skill of skills || []) {
    if (!skill || typeof skill.name !== "string") continue;
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return byName;
}

function usableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function translateSkillNamesWithCache({
  cachePath,
  skills,
  names,
  lang,
  translateMissing,
}) {
  const requested = uniqueStrings(names);
  if (!cachePath || !lang || lang === "en" || requested.length === 0) return {};
  if (typeof translateMissing !== "function") {
    throw new Error("translateMissing must be a function");
  }

  const cache = readCache(cachePath);
  if (!cache.translations[lang] || typeof cache.translations[lang] !== "object") {
    cache.translations[lang] = {};
  }
  const langCache = cache.translations[lang];
  const skillsByName = indexSkillsByName(skills);

  const result = {};
  const misses = [];

  for (const name of requested) {
    const skill = skillsByName.get(name);
    if (!skill) continue;

    const fingerprint = fingerprintSkill(skill);
    const cached = langCache[name];
    if (
      fingerprint
      && cached
      && cached.fingerprint === fingerprint
      && usableText(cached.text)
    ) {
      result[name] = cached.text.trim();
      continue;
    }

    misses.push({ name, fingerprint });
  }

  if (misses.length === 0) return result;

  const translated = await translateMissing(misses.map(m => m.name));
  let dirty = false;
  for (const miss of misses) {
    const text = usableText(translated?.[miss.name]);
    if (!text) continue;
    result[miss.name] = text;
    if (!miss.fingerprint) continue;
    langCache[miss.name] = {
      text,
      fingerprint: miss.fingerprint,
      updatedAt: Date.now(),
    };
    dirty = true;
  }

  if (dirty) writeCache(cachePath, cache);
  return result;
}
