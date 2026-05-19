import crypto from "crypto";
import fs from "fs";
import path from "path";

const STORE_FILE = "skill-bundles.json";
const SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, bundles: [] };
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function slugify(value) {
  return String(value || "bundle")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "bundle";
}

function randomSuffix() {
  return crypto.randomBytes(3).toString("hex");
}

function normalizeBundle(bundle) {
  const id = typeof bundle?.id === "string" && bundle.id.trim()
    ? bundle.id.trim()
    : `${slugify(bundle?.name)}-${randomSuffix()}`;
  const name = typeof bundle?.name === "string" && bundle.name.trim()
    ? bundle.name.trim()
    : "Skill Bundle";
  const createdAt = typeof bundle?.createdAt === "string" ? bundle.createdAt : nowIso();
  const updatedAt = typeof bundle?.updatedAt === "string" ? bundle.updatedAt : createdAt;
  return {
    id,
    name,
    skillNames: uniqueStrings(bundle?.skillNames),
    source: typeof bundle?.source === "string" ? bundle.source : "user",
    agentId: typeof bundle?.agentId === "string" ? bundle.agentId : null,
    sourcePackage: typeof bundle?.sourcePackage === "string" ? bundle.sourcePackage : null,
    createdAt,
    updatedAt,
  };
}

function normalizeStore(raw) {
  const store = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    bundles: Array.isArray(store.bundles)
      ? store.bundles.map(normalizeBundle)
      : [],
  };
}

function allocateBundleId(store, baseName) {
  const base = slugify(baseName);
  const used = new Set(store.bundles.map(bundle => bundle.id));
  if (!used.has(base)) return base;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`cannot allocate unique skill bundle id for ${baseName}`);
}

export function getSkillBundleStorePath(engine) {
  if (!engine?.hanakoHome) throw new Error("hanakoHome is required for skill bundle store");
  return path.join(engine.hanakoHome, STORE_FILE);
}

export function loadSkillBundleStore(engine) {
  const filePath = getSkillBundleStorePath(engine);
  if (!fs.existsSync(filePath)) return emptyStore();
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return normalizeStore(raw);
}

export function saveSkillBundleStore(engine, store) {
  const filePath = getSkillBundleStorePath(engine);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = normalizeStore(store);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

export function recordSkillBundle(engine, {
  name,
  skillNames,
  source = "user",
  agentId = null,
  sourcePackage = null,
} = {}) {
  const normalizedSkillNames = uniqueStrings(skillNames);
  if (normalizedSkillNames.length === 0) return null;
  const store = loadSkillBundleStore(engine);
  const record = normalizeBundle({
    id: allocateBundleId(store, name),
    name: typeof name === "string" && name.trim() ? name.trim() : "Skill Bundle",
    skillNames: normalizedSkillNames,
    source,
    agentId,
    sourcePackage,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  store.bundles.push(record);
  saveSkillBundleStore(engine, store);
  return record;
}

export function createSkillBundle(engine, {
  name,
  skillNames = [],
  source = "user",
  agentId = null,
  sourcePackage = null,
} = {}) {
  const store = loadSkillBundleStore(engine);
  const record = normalizeBundle({
    id: allocateBundleId(store, name),
    name: typeof name === "string" && name.trim() ? name.trim() : "Skill Bundle",
    skillNames,
    source,
    agentId,
    sourcePackage,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  store.bundles.push(record);
  saveSkillBundleStore(engine, store);
  return record;
}

export function updateSkillBundle(engine, id, patch = {}) {
  const bundleId = typeof id === "string" ? id.trim() : "";
  if (!bundleId) throw new Error("bundle id is required");
  const store = loadSkillBundleStore(engine);
  const index = store.bundles.findIndex(bundle => bundle.id === bundleId);
  if (index === -1) throw new Error("skill bundle not found");
  const current = store.bundles[index];
  const next = normalizeBundle({
    ...current,
    name: typeof patch.name === "string" ? patch.name : current.name,
    skillNames: Array.isArray(patch.skillNames) ? patch.skillNames : current.skillNames,
    updatedAt: nowIso(),
  });
  store.bundles[index] = next;
  saveSkillBundleStore(engine, store);
  return next;
}

export function reorderSkillBundles(engine, bundleIds) {
  const orderedIds = uniqueStrings(bundleIds);
  if (orderedIds.length === 0) throw new Error("bundleIds must be a non-empty array");
  const store = loadSkillBundleStore(engine);
  if (orderedIds.length !== store.bundles.length) {
    throw new Error("bundleIds must include every skill bundle exactly once");
  }
  const byId = new Map(store.bundles.map(bundle => [bundle.id, bundle]));
  const now = nowIso();
  const bundles = orderedIds.map((id) => {
    const bundle = byId.get(id);
    if (!bundle) throw new Error(`unknown skill bundle: ${id}`);
    return { ...bundle, updatedAt: now };
  });
  return saveSkillBundleStore(engine, { ...store, bundles });
}

export function deleteSkillBundle(engine, id) {
  const bundleId = typeof id === "string" ? id.trim() : "";
  if (!bundleId) throw new Error("bundle id is required");
  const filePath = getSkillBundleStorePath(engine);
  if (!fs.existsSync(filePath)) return false;
  const store = loadSkillBundleStore(engine);
  const before = store.bundles.length;
  store.bundles = store.bundles.filter(bundle => bundle.id !== bundleId);
  if (store.bundles.length === before) return false;
  saveSkillBundleStore(engine, store);
  return true;
}

export function detachAgentFromBundles(engine, agentId) {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) return loadSkillBundleStore(engine);
  const filePath = getSkillBundleStorePath(engine);
  if (!fs.existsSync(filePath)) return emptyStore();
  const store = loadSkillBundleStore(engine);
  let changed = false;
  const bundles = store.bundles.map((bundle) => {
    if (bundle.agentId !== id) return bundle;
    changed = true;
    return {
      ...bundle,
      agentId: null,
      updatedAt: nowIso(),
    };
  });
  if (!changed) return store;
  return saveSkillBundleStore(engine, { ...store, bundles });
}

export function removeSkillsFromBundles(engine, skillNames) {
  const names = new Set(uniqueStrings(skillNames));
  if (names.size === 0) return loadSkillBundleStore(engine);
  const filePath = getSkillBundleStorePath(engine);
  if (!fs.existsSync(filePath)) return emptyStore();
  const store = loadSkillBundleStore(engine);
  const updated = {
    ...store,
    bundles: store.bundles
      .map(bundle => ({
        ...bundle,
        skillNames: bundle.skillNames.filter(name => !names.has(name)),
        updatedAt: nowIso(),
      }))
      .filter(bundle => bundle.skillNames.length > 0),
  };
  return saveSkillBundleStore(engine, updated);
}
