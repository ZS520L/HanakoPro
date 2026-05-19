import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import YAML from "js-yaml";
import { extractZip } from "../extract-zip.js";
import { FactStore } from "../memory/fact-store.js";
import {
  compactCompiledMemory,
  emptyCompiledMemory,
  hasCompiledMemory,
  normalizeCompiledMemory,
  readCompiledMemorySnapshot,
} from "../memory/compiled-memory-snapshot.js";
import { normalizePlainDescription } from "../text/internal-narration.js";
import { sanitizeSkillName } from "../tools/install-skill.js";
import { writeZipFromDirectory } from "../zip-writer.js";
import { safeCopyDir } from "../../shared/safe-fs.js";
import { relativePathInsideBase } from "../../core/message-utils.js";
import { fromRoot } from "../../shared/hana-root.js";
import { loadSkillBundleStore, recordSkillBundle } from "../skill-bundles/store.js";

const VALID_YUAN = new Set(["hanako", "butter", "ming", "kong"]);
const CARD_FILE_NAMES = [
  "manifest.json",
  "manifest.yaml",
  "manifest.yml",
  "character-card.json",
  "character-card.yaml",
  "character-card.yml",
  "card.json",
  "card.yaml",
  "card.yml",
];
const IMAGE_EXT_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const MEMORY_PREVIEW_LENGTH = 20;

class CharacterCardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CharacterCardError";
    this.status = status;
  }
}

function randomToken() {
  return crypto.randomBytes(12).toString("hex");
}

function suffixFor(seed, attempt = 0) {
  return crypto
    .createHash("sha256")
    .update(`${seed}:${attempt}`)
    .digest("hex")
    .slice(0, 6);
}

function assertSafeToken(token) {
  if (!/^[a-f0-9]{24}$/.test(String(token || ""))) {
    throw new CharacterCardError("invalid import token", 400);
  }
}

function isZipPath(filePath) {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".hana-package.zip");
}

function isStructuredCardPath(filePath) {
  return [".json", ".yaml", ".yml"].includes(path.extname(filePath).toLowerCase());
}

function parseStructuredFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (path.extname(filePath).toLowerCase() === ".json") {
    return JSON.parse(raw);
  }
  return YAML.load(raw);
}

function safeResolve(root, relativePath, label = "file") {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new CharacterCardError(`${label} path is required`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new CharacterCardError(`${label} must be a package-relative path`);
  }
  const resolved = path.resolve(root, relativePath);
  const rel = relativePathInsideBase(resolved, root);
  if (rel === null) {
    throw new CharacterCardError(`${label} escapes the package`);
  }
  return { resolved, rel };
}

function ensureNoSymlinks(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        throw new CharacterCardError("symlink is not allowed in character-card packages");
      }
      if (stat.isDirectory()) stack.push(full);
    }
  }
}

function findCardDescriptor(packageRoot) {
  for (const name of CARD_FILE_NAMES) {
    const candidate = path.join(packageRoot, name);
    if (fs.existsSync(candidate)) {
      const data = parseStructuredFile(candidate);
      if (data?.card && typeof data.card === "string") {
        const { resolved } = safeResolve(packageRoot, data.card, "card");
        if (!fs.existsSync(resolved)) throw new CharacterCardError("declared card file not found");
        return { data: parseStructuredFile(resolved), manifest: data, cardPath: resolved };
      }
      return { data, manifest: data, cardPath: candidate };
    }
  }
  throw new CharacterCardError("character-card manifest not found");
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFacts(card) {
  const facts = card?.memory?.facts || card?.facts || card?.memories || [];
  if (!Array.isArray(facts)) return [];
  return facts
    .map((entry) => ({
      fact: trimString(entry?.fact || entry?.content || entry?.text),
      tags: Array.isArray(entry?.tags) ? entry.tags.filter(tag => typeof tag === "string") : [],
      time: entry?.time || entry?.date || null,
      session_id: entry?.session_id || "character-card-import",
    }))
    .filter(entry => entry.fact);
}

function firstString(...values) {
  return values.find(value => typeof value === "string" && value.trim()) || "";
}

function normalizeMemoryCompiled(card) {
  const compiled = card?.memory?.compiled && typeof card.memory.compiled === "object"
    ? card.memory.compiled
    : {};
  return normalizeCompiledMemory({
    facts: firstString(
      compiled.facts,
      card?.memory?.compiledFacts,
      card?.memory?.factsText,
    ),
    today: firstString(
      compiled.today,
      card?.memory?.today,
      card?.memory?.todayPreview,
      card?.todayMemory,
    ),
    week: firstString(
      compiled.week,
      card?.memory?.week,
      card?.memory?.weekPreview,
      card?.weekMemory,
    ),
    longterm: firstString(
      compiled.longterm,
      compiled.longTerm,
      card?.memory?.longterm,
      card?.memory?.longTerm,
      card?.longtermMemory,
    ),
  });
}

function previewText(value, length = MEMORY_PREVIEW_LENGTH) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length).join("")}...` : text;
}

function memoryPreview(plan) {
  const compiledFactsPreview = previewText(plan.memoryCompiled?.facts);
  if (compiledFactsPreview) return compiledFactsPreview;
  const structuredFactsPreview = previewText(plan.memoryFacts.map(entry => entry.fact).filter(Boolean).join(" "));
  if (structuredFactsPreview) return structuredFactsPreview;
  const timelinePreview = previewText(plan.memoryCompiled?.today)
    || previewText(plan.memoryCompiled?.week)
    || previewText(plan.memoryCompiled?.longterm);
  if (timelinePreview) return timelinePreview;
  return "无记忆";
}

function hasImportableOrExportableMemory(plan) {
  const hasFacts = plan.memoryFacts.length > 0;
  if (hasFacts) return true;
  return hasCompiledMemory(plan.memoryCompiled);
}

function normalizeTextFiles(card) {
  const identity = card?.identity;
  const prompts = card?.prompts || {};
  return {
    identity: trimString(prompts.identity || identity?.content || identity?.prompt || (typeof identity === "string" ? identity : "")) || null,
    ishiki: trimString(prompts.ishiki || prompts.yuan || card?.ishiki) || null,
    publicIshiki: trimString(prompts.publicIshiki || prompts.public_ishiki || card?.publicIshiki) || null,
  };
}

function normalizeAgent(card) {
  const agent = card?.agent || card?.character || {};
  const name = trimString(agent.name || card?.name);
  if (!name) throw new CharacterCardError("agent.name is required");
  const id = trimString(agent.id || card?.id) || null;
  if (id && (/[\/\\]|\.\./.test(id))) {
    throw new CharacterCardError("agent.id is invalid");
  }
  const yuan = VALID_YUAN.has(agent.yuan || card?.yuan) ? (agent.yuan || card?.yuan) : "hanako";
  const description = trimString(agent.description || card?.agentDescription || card?.description);
  const identitySummary = trimString(
    card?.identity?.summary ||
    agent.identity ||
    card?.summary ||
    card?.description,
  );
  return { name, id, yuan, description, identitySummary };
}

function normalizePackageName(card, manifest, sourceName) {
  return trimString(card?.package?.name || manifest?.name || card?.name) || sourceName || "Character Card";
}

function normalizeAssetRefs(card, packageRoot) {
  const input = card?.assets || {};
  const refs = {
    avatar: input.avatar || input.portrait,
    cardFront: input.cardFront || input.card_front || input.front,
    cardBack: input.cardBack || input.card_back || input.back,
    yuanIcon: input.yuanIcon || input.yuan_icon,
  };
  const assets = {};
  for (const [key, ref] of Object.entries(refs)) {
    if (!ref) continue;
    const { resolved, rel } = safeResolve(packageRoot, ref, `asset.${key}`);
    if (!fs.existsSync(resolved)) throw new CharacterCardError(`asset.${key} not found`);
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXT_TO_MIME[ext]) throw new CharacterCardError(`asset.${key} has unsupported image type`);
    assets[key] = { rel, mime: IMAGE_EXT_TO_MIME[ext], fileName: path.basename(resolved) };
  }
  return assets;
}

function normalizeSkillDeclarations(card, packageRoot) {
  const bundles = [];
  const rawSkills = card?.skills;
  if (rawSkills && Array.isArray(rawSkills.bundles)) {
    for (const bundle of rawSkills.bundles) {
      bundles.push({
        name: trimString(bundle?.name) || "Skill Bundle",
        skills: Array.isArray(bundle?.skills) ? bundle.skills : [],
      });
    }
  } else if (Array.isArray(card?.skillBundles)) {
    for (const bundle of card.skillBundles) {
      bundles.push({
        name: trimString(bundle?.name) || "Skill Bundle",
        skills: Array.isArray(bundle?.skills) ? bundle.skills : [],
      });
    }
  }

  if (Array.isArray(rawSkills)) {
    bundles.push({ name: "Imported Skills", skills: rawSkills });
  } else if (rawSkills && Array.isArray(rawSkills.items)) {
    bundles.push({ name: trimString(rawSkills.name) || "Imported Skills", skills: rawSkills.items });
  }

  const normalized = [];
  for (const bundle of bundles) {
    for (const skill of bundle.skills) {
      const skillPath = typeof skill === "string" ? skill : skill?.path;
      const { resolved, rel } = safeResolve(packageRoot, skillPath, "skill");
      const skillMdPath = path.join(resolved, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) throw new CharacterCardError(`skill missing SKILL.md: ${rel}`);
      const name = parseSkillName(fs.readFileSync(skillMdPath, "utf-8"));
      const safeName = sanitizeSkillName(name);
      if (!safeName) throw new CharacterCardError(`skill name is invalid: ${name || "(missing)"}`);
      normalized.push({
        name: safeName,
        path: rel,
        bundle: bundle.name,
      });
    }
  }
  return normalized;
}

function parseSkillName(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
    if (nameMatch) return nameMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  const commentMatch = content.match(/<!--\s*name:\s*(.+?)\s*-->/);
  if (commentMatch) return commentMatch[1].trim();
  const headingMatch = content.match(/^#\s+(.+?)$/m);
  return headingMatch ? headingMatch[1].trim() : null;
}

function rewriteSkillName(content, newName) {
  if (/^---\s*\n[\s\S]*?\n---/.test(content)) {
    const replaced = content.replace(/^name:\s*.+$/m, `name: ${newName}`);
    if (replaced !== content) return replaced;
  }
  return `---\nname: ${newName}\n---\n\n${content}`;
}

function serializePlan(plan) {
  const bundles = new Map();
  for (const skill of plan.skills) {
    if (!bundles.has(skill.bundle)) bundles.set(skill.bundle, []);
    bundles.get(skill.bundle).push({ name: skill.name });
  }
  const bundleList = [...bundles.entries()].map(([name, skills]) => ({
    name,
    skillCount: skills.length,
    skills,
  }));
  const agentForPreview = Object.fromEntries(
    Object.entries(plan.agent).filter(([key, value]) => key !== "id" && value !== "" && value != null),
  );
  return {
    token: plan.token,
    mode: plan.mode || "import",
    packageName: plan.packageName,
    agent: agentForPreview,
    prompts: {
      identity: plan.prompts?.identity || "",
      ishiki: plan.prompts?.ishiki || "",
      publicIshiki: plan.prompts?.publicIshiki || "",
    },
    memory: {
      available: hasImportableOrExportableMemory(plan),
      count: memoryItemCount(plan),
      preview: memoryPreview(plan),
      compiled: plan.memoryCompiled || emptyCompiledMemory(),
    },
    skills: {
      count: plan.skills.length,
      bundles: bundleList,
    },
    assets: Object.fromEntries(Object.keys(plan.assets).map(key => [key, true])),
  };
}

function readOptionalText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function readOptionalDescription(agentDir) {
  const raw = readOptionalText(path.join(agentDir, "description.md"))
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith("<!--"))
    .join("\n")
    .trim();
  return normalizePlainDescription(raw);
}

function firstNonEmptyLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) || "";
}

function defaultAvatarForYuan(yuan) {
  const fileName = {
    hanako: "Hanako.png",
    butter: "Butter.png",
    ming: "Ming.png",
    kong: "Kong.png",
  }[yuan] || "Hanako.png";
  return fromRoot("desktop", "src", "assets", fileName);
}

function defaultCardBackForYuan(yuan) {
  const fileName = {
    hanako: "yuan-hanako-card-back.png",
    butter: "yuan-butter-card-back.png",
    ming: "yuan-ming-card-back.png",
    kong: "yuan-kong-card-back.png",
  }[yuan] || "yuan-hanako-card-back.png";
  return fromRoot("desktop", "src", "assets", "character-cards", fileName);
}

function defaultYuanIconForYuan(yuan) {
  const fileName = {
    hanako: "yuan-hanako-emblem.png",
    butter: "yuan-butter-emblem.png",
    ming: "yuan-ming-emblem.png",
    kong: "yuan-kong-emblem.png",
  }[yuan] || "yuan-hanako-emblem.png";
  return fromRoot("desktop", "src", "assets", "character-cards", fileName);
}

function findAgentAvatar(agentDir) {
  const avatarDir = path.join(agentDir, "avatars");
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const candidate = path.join(avatarDir, `agent.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function extensionForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXT_TO_MIME[ext]) return ".png";
  return ext === ".jpeg" ? ".jpg" : ext;
}

function mimeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXT_TO_MIME[ext] || "image/png";
}

function copyPlanAsset(plan, sourcePath, key, targetBaseName) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  const ext = extensionForImage(sourcePath);
  let rel = `assets/${targetBaseName}${ext}`;
  let dst = path.join(plan.packageRoot, rel);
  for (let attempt = 1; fs.existsSync(dst); attempt++) {
    rel = `assets/${targetBaseName}-${attempt}${ext}`;
    dst = path.join(plan.packageRoot, rel);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(sourcePath, dst);
  plan.assets[key] = {
    rel,
    mime: IMAGE_EXT_TO_MIME[ext === ".jpg" ? ".jpg" : ext] || "image/png",
    fileName: path.basename(dst),
  };
  return true;
}

function ensurePreviewAssets(plan) {
  const yuan = plan.agent?.yuan || "hanako";
  if (!plan.assets.avatar) {
    copyPlanAsset(plan, defaultAvatarForYuan(yuan), "avatar", "hana-default-avatar");
  }
  if (!plan.assets.cardFront && plan.assets.avatar) {
    plan.assets.cardFront = { ...plan.assets.avatar };
  }
  if (!plan.assets.cardBack) {
    copyPlanAsset(plan, defaultCardBackForYuan(yuan), "cardBack", "hana-default-card-back");
  }
  if (!plan.assets.yuanIcon) {
    copyPlanAsset(plan, defaultYuanIconForYuan(yuan), "yuanIcon", "hana-default-yuan-icon");
  }
}

function sanitizeExportFileBase(value) {
  const fallback = "hana";
  const raw = String(value || fallback).trim() || fallback;
  const ascii = raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || fallback;
}

function exportFileNameForAgent(agentId) {
  return `${sanitizeExportFileBase(agentId)}-charactercard.zip`;
}

function resolveUniqueExportPath(targetDir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(targetDir, fileName);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${base}-${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function resolveDefaultExportTargetDir(engine) {
  const candidates = [engine?.deskCwd, engine?.homeCwd, engine?.cwd, process.cwd()];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return process.cwd();
}

function compiledMemoryBlockCount(compiled) {
  const normalized = normalizeCompiledMemory(compiled);
  return Object.values(normalized).filter(Boolean).length;
}

function memoryItemCount(plan) {
  return plan.memoryFacts.length + compiledMemoryBlockCount(plan.memoryCompiled);
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function skillBundlesForCard(skills) {
  const bundles = new Map();
  for (const skill of skills) {
    const bundleName = trimString(skill.bundle) || "Skill Bundle";
    if (!bundles.has(bundleName)) bundles.set(bundleName, []);
    bundles.get(bundleName).push({ name: skill.name, path: skill.path });
  }
  return [...bundles.entries()].map(([name, items]) => ({ name, skills: items }));
}

export function createCharacterCardService(engine) {
  const stagingRoot = path.join(engine.hanakoHome, ".ephemeral", "character-card-imports");

  function planPath(token) {
    assertSafeToken(token);
    return path.join(stagingRoot, token, "plan.json");
  }

  function loadPlan(token) {
    const filePath = planPath(token);
    if (!fs.existsSync(filePath)) throw new CharacterCardError("import plan not found", 404);
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  function exportMemoryFactsForAgent(agent, agentDir) {
    if (agent?.factStore?.exportAll) {
      const facts = agent.factStore.exportAll();
      return Array.isArray(facts) ? facts : [];
    }
    const dbPath = path.join(agentDir, "memory", "facts.db");
    if (!fs.existsSync(dbPath)) return [];
    const store = new FactStore(dbPath);
    try {
      const facts = store.exportAll();
      return Array.isArray(facts) ? facts : [];
    } finally {
      store.close();
    }
  }

  function resolveUniqueAgentId(rawId, token) {
    if (!rawId) return undefined;
    if (!fs.existsSync(path.join(engine.agentsDir, rawId))) return rawId;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = `${rawId}-${suffixFor(`${token}:${rawId}`, attempt)}`;
      if (!fs.existsSync(path.join(engine.agentsDir, candidate))) return candidate;
    }
    throw new CharacterCardError("cannot allocate unique agent id");
  }

  function resolveUniqueSkillName(baseName, token, index, reserved) {
    if (!reserved.has(baseName) && !fs.existsSync(path.join(engine.userSkillsDir, baseName))) {
      reserved.add(baseName);
      return baseName;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = `${baseName}-${suffixFor(`${token}:${baseName}:${index}`, attempt)}`;
      if (!reserved.has(candidate) && !fs.existsSync(path.join(engine.userSkillsDir, candidate))) {
        reserved.add(candidate);
        return candidate;
      }
    }
    throw new CharacterCardError(`cannot allocate unique skill name for ${baseName}`);
  }

  async function createImportPlanFromPath(sourcePath, opts = {}) {
    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      throw new CharacterCardError("source path must be absolute");
    }
    if (!fs.existsSync(sourcePath)) throw new CharacterCardError("source path not found");

    const token = randomToken();
    const stageDir = path.join(stagingRoot, token);
    const packageRoot = path.join(stageDir, "package");
    await fsp.mkdir(packageRoot, { recursive: true });

    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink()) throw new CharacterCardError("symlink source is not allowed");
    if (stat.isDirectory()) {
      ensureNoSymlinks(sourcePath);
      fs.cpSync(sourcePath, packageRoot, { recursive: true });
    } else if (isZipPath(sourcePath)) {
      await extractZip(sourcePath, packageRoot);
      ensureNoSymlinks(packageRoot);
    } else if (isStructuredCardPath(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(packageRoot, path.basename(sourcePath)));
    } else {
      throw new CharacterCardError("unsupported character-card package type");
    }

    const { data: card, manifest } = findCardDescriptor(packageRoot);
    const plan = {
      token,
      packageRoot,
      sourceName: opts.originalName || path.basename(sourcePath),
      packageName: normalizePackageName(card, manifest, opts.originalName || path.basename(sourcePath)),
      agent: normalizeAgent(card),
      prompts: normalizeTextFiles(card),
      memoryFacts: normalizeFacts(card),
      memoryCompiled: normalizeMemoryCompiled(card),
      assets: normalizeAssetRefs(card, packageRoot),
      skills: normalizeSkillDeclarations(card, packageRoot),
      createdAt: new Date().toISOString(),
    };
    ensurePreviewAssets(plan);

    await fsp.writeFile(path.join(stageDir, "plan.json"), JSON.stringify(plan, null, 2), "utf-8");
    return serializePlan(plan);
  }

  async function installPackagedSkills(plan) {
    if (plan.skills.length === 0) return [];
    loadSkillBundleStore(engine);
    fs.mkdirSync(engine.userSkillsDir, { recursive: true });
    const reserved = new Set();
    const installed = [];
    try {
      for (let i = 0; i < plan.skills.length; i++) {
        const skill = plan.skills[i];
        const srcDir = path.join(plan.packageRoot, skill.path);
        ensureNoSymlinks(srcDir);
        const dstName = resolveUniqueSkillName(skill.name, plan.token, i, reserved);
        const dstDir = path.join(engine.userSkillsDir, dstName);
        safeCopyDir(srcDir, dstDir);
        if (dstName !== skill.name) {
          const skillMdPath = path.join(dstDir, "SKILL.md");
          const current = fs.readFileSync(skillMdPath, "utf-8");
          fs.writeFileSync(skillMdPath, rewriteSkillName(current, dstName), "utf-8");
        }
        installed.push({
          name: dstName,
          originalName: skill.name,
          bundle: skill.bundle,
          dir: dstDir,
        });
      }
      await engine.reloadSkills?.();
      return installed.map(({ dir: _dir, ...rest }) => rest);
    } catch (err) {
      for (const item of installed) {
        try { fs.rmSync(item.dir, { recursive: true, force: true }); } catch {}
      }
      throw err;
    }
  }

  function normalizeAvatarPath(plan) {
    const avatar = plan.assets.avatar;
    if (!avatar) return null;
    return path.join(plan.packageRoot, avatar.rel);
  }

  function readAgentExportSource(agentId) {
    const agent = engine.getAgent?.(agentId);
    const agentDir = agent?.agentDir || path.join(engine.agentsDir, agentId);
    const configPath = path.join(agentDir, "config.yaml");
    if (!fs.existsSync(configPath)) throw new CharacterCardError("agent not found", 404);
    const config = YAML.load(fs.readFileSync(configPath, "utf-8")) || {};
    const yuan = VALID_YUAN.has(config?.agent?.yuan) ? config.agent.yuan : "hanako";
    const name = trimString(config?.agent?.name) || agent?.agentName || agentId;
    const identity = readOptionalText(path.join(agentDir, "identity.md"));
    const ishiki = readOptionalText(path.join(agentDir, "ishiki.md"));
    const publicIshiki = readOptionalText(path.join(agentDir, "public-ishiki.md"));
    const description = readOptionalDescription(agentDir);
    const memoryFacts = exportMemoryFactsForAgent(agent, agentDir);
    const memoryCompiled = readCompiledMemorySnapshot(path.join(agentDir, "memory"));
    return {
      agent,
      agentDir,
      config,
      name,
      yuan,
      identity,
      ishiki,
      publicIshiki,
      description,
      identitySummary: firstNonEmptyLine(identity),
      memoryFacts: Array.isArray(memoryFacts) ? memoryFacts : [],
      memoryCompiled,
    };
  }

  function exportAssetSources(source) {
    const avatarSource = findAgentAvatar(source.agentDir) || defaultAvatarForYuan(source.yuan);
    return {
      avatar: avatarSource,
      cardFront: avatarSource,
      cardBack: defaultCardBackForYuan(source.yuan),
      yuanIcon: defaultYuanIconForYuan(source.yuan),
    };
  }

  function exportAssetFlags(source) {
    return Object.fromEntries(
      Object.entries(exportAssetSources(source))
        .filter(([, filePath]) => filePath && fs.existsSync(filePath))
        .map(([key]) => [key, true]),
    );
  }

  function enabledExportSkills(agentId) {
    const skills = engine.getAllSkills?.(agentId) || [];
    return skills.filter(skill => {
      if (!skill?.enabled) return false;
      if (!skill.baseDir || !skill.filePath) return false;
      if (!fs.existsSync(path.join(skill.baseDir, "SKILL.md"))) return false;
      if (skill.readonly && skill.source === "external") return false;
      return true;
    });
  }

  function exportSkillPreviewItems(source, agentId) {
    return enabledExportSkills(agentId).map(skill => ({
      name: sanitizeSkillName(skill.name),
      bundle: `${source.name} Bundle`,
    })).filter(skill => skill.name);
  }

  function serializeExportPreview(source, agentId, skills = exportSkillPreviewItems(source, agentId)) {
    const planLike = {
      memoryFacts: source.memoryFacts,
      memoryCompiled: source.memoryCompiled,
    };
    const bundles = new Map();
    for (const skill of skills) {
      if (!bundles.has(skill.bundle)) bundles.set(skill.bundle, []);
      bundles.get(skill.bundle).push({ name: skill.name });
    }
    return {
      mode: "export",
      agentId,
      packageName: exportFileNameForAgent(source.name || agentId),
      agent: {
        name: source.name,
        yuan: source.yuan,
        ...(source.description ? { description: source.description } : {}),
        ...(source.identitySummary ? { identitySummary: source.identitySummary } : {}),
      },
      prompts: {
        identity: source.identity,
        ishiki: source.ishiki,
        publicIshiki: source.publicIshiki,
      },
      memory: {
        available: hasImportableOrExportableMemory(planLike),
        count: memoryItemCount(planLike),
        preview: memoryPreview(planLike),
        compiled: source.memoryCompiled || emptyCompiledMemory(),
      },
      skills: {
        count: skills.length,
        bundles: [...bundles.entries()].map(([name, bundleSkills]) => ({
          name,
          skillCount: bundleSkills.length,
          skills: bundleSkills,
        })),
      },
      assets: exportAssetFlags(source),
    };
  }

  function copyExportSkills(plan, agentId) {
    const skills = enabledExportSkills(agentId);
    const copied = [];
    const reserved = new Set();
    for (const skill of skills) {
      const safeName = sanitizeSkillName(skill.name);
      if (!safeName || reserved.has(safeName)) continue;
      reserved.add(safeName);
      const rel = `skills/${safeName}`;
      safeCopyDir(skill.baseDir, path.join(plan.packageRoot, rel));
      copied.push({
        name: safeName,
        path: rel,
        bundle: `${plan.agent.name} Bundle`,
      });
    }
    return copied;
  }

  function copyExportAssets(plan, source) {
    const sources = exportAssetSources(source);
    copyPlanAsset(plan, sources.avatar, "avatar", "avatar");
    copyPlanAsset(plan, sources.cardFront, "cardFront", "card-front");
    copyPlanAsset(plan, sources.cardBack, "cardBack", "card-back");
    copyPlanAsset(plan, sources.yuanIcon, "yuanIcon", "yuan-icon");
    ensurePreviewAssets(plan);
  }

  function buildExportCard(plan, { exportMemory = false } = {}) {
    const card = {
      kind: "CharacterCard",
      schemaVersion: 1,
      package: {
        name: plan.packageName,
        exportedAt: new Date().toISOString(),
      },
      agent: {
        name: plan.agent.name,
        yuan: plan.agent.yuan,
        ...(plan.agent.description ? { description: plan.agent.description } : {}),
      },
      identity: {
        summary: plan.agent.identitySummary || "",
        content: plan.prompts.identity || "",
      },
      prompts: {
        identity: plan.prompts.identity || "",
        ishiki: plan.prompts.ishiki || "",
        publicIshiki: plan.prompts.publicIshiki || "",
      },
      assets: Object.fromEntries(
        Object.entries(plan.assets).map(([key, asset]) => [key, asset.rel]),
      ),
    };
    if (plan.skills.length > 0) {
      card.skills = { bundles: skillBundlesForCard(plan.skills) };
    }
    if (exportMemory) {
      const memory = {};
      if (plan.memoryFacts.length > 0) memory.facts = plan.memoryFacts;
      if (hasCompiledMemory(plan.memoryCompiled)) {
        memory.compiled = compactCompiledMemory(plan.memoryCompiled);
      }
      if (Object.keys(memory).length > 0) card.memory = memory;
    }
    return card;
  }

  async function createExportPreview(agentId) {
    if (!agentId) throw new CharacterCardError("agentId is required");
    const source = readAgentExportSource(agentId);
    return serializeExportPreview(source, agentId);
  }

  async function createExportPackagePlan(agentId, packageRoot) {
    const source = readAgentExportSource(agentId);
    const plan = {
      mode: "export",
      packageRoot,
      sourceName: exportFileNameForAgent(source.name || agentId),
      packageName: exportFileNameForAgent(source.name || agentId),
      agent: {
        name: source.name,
        id: agentId,
        yuan: source.yuan,
        description: source.description,
        identitySummary: source.identitySummary,
      },
      prompts: {
        identity: source.identity,
        ishiki: source.ishiki,
        publicIshiki: source.publicIshiki,
      },
      memoryFacts: source.memoryFacts,
      memoryCompiled: source.memoryCompiled,
      assets: {},
      skills: [],
      createdAt: new Date().toISOString(),
    };

    copyExportAssets(plan, source);
    plan.skills = copyExportSkills(plan, agentId);
    return { plan, source };
  }

  async function exportAgentPackage(agentId, options = {}) {
    if (!agentId) throw new CharacterCardError("agentId is required");
    const targetDir = options.targetDir || resolveDefaultExportTargetDir(engine);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw new CharacterCardError("export target directory not found");
    }
    const token = randomToken();
    const exportRoot = path.join(engine.hanakoHome, ".ephemeral", "character-card-exports", token);
    const packageRoot = path.join(exportRoot, "package");
    try {
      await fsp.mkdir(packageRoot, { recursive: true });
      const { plan, source } = await createExportPackagePlan(agentId, packageRoot);
      writeJsonFile(path.join(plan.packageRoot, "card.json"), buildExportCard(plan, {
        exportMemory: options.exportMemory === true,
      }));
      const fileName = plan.packageName.endsWith(".zip") ? plan.packageName : `${plan.packageName}.zip`;
      const filePath = resolveUniqueExportPath(targetDir, fileName);
      await writeZipFromDirectory(plan.packageRoot, filePath);
      return {
        ok: true,
        filePath,
        fileName,
        plan: serializeExportPreview(source, agentId, plan.skills),
      };
    } finally {
      await fsp.rm(exportRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  function importFacts(agentId, facts) {
    if (facts.length === 0) return 0;
    const normalized = facts.map((entry) => ({
      fact: entry.fact,
      tags: entry.tags || [],
      time: entry.time || null,
      session_id: entry.session_id || "character-card-import",
    }));
    const agent = engine.getAgent?.(agentId);
    if (agent?.factStore) {
      agent.factStore.importAll(normalized);
      return normalized.length;
    }
    const store = new FactStore(path.join(engine.agentsDir, agentId, "memory", "facts.db"));
    try {
      store.importAll(normalized);
      return normalized.length;
    } finally {
      store.close();
    }
  }

  async function commitImportPlan(token, options = {}) {
    const plan = loadPlan(token);
    const installedSkills = await installPackagedSkills(plan);
    const agentId = resolveUniqueAgentId(plan.agent.id, plan.token);
    const shouldImportCompiledMemory = options.importMemory === true && hasCompiledMemory(plan.memoryCompiled);
    const created = await engine.createAgent({
      name: plan.agent.name,
      id: agentId,
      yuan: plan.agent.yuan,
      enabledSkills: installedSkills.map(skill => skill.name),
      initialFiles: plan.prompts,
      avatarPath: normalizeAvatarPath(plan),
      initialMemory: shouldImportCompiledMemory
        ? {
            compiled: plan.memoryCompiled,
            sourceId: `character-card-import-${plan.token}`,
            sourcePackage: plan.packageName,
          }
        : null,
    });
    const skillBundles = recordImportedSkillBundles(plan, installedSkills, created.id);
    const importedMemory = options.importMemory ? importFacts(created.id, plan.memoryFacts) : 0;
    engine.invalidateAgentListCache?.();
    return {
      ok: true,
      agent: created,
      installedSkills,
      skillBundles,
      importedMemory,
      importedCompiledMemory: shouldImportCompiledMemory,
      plan: serializePlan(plan),
    };
  }

  function recordImportedSkillBundles(plan, installedSkills, agentId) {
    if (installedSkills.length === 0) return [];
    const grouped = new Map();
    for (const skill of installedSkills) {
      const bundleName = trimString(skill.bundle) || `${plan.agent.name} Bundle`;
      if (!grouped.has(bundleName)) grouped.set(bundleName, []);
      grouped.get(bundleName).push(skill.name);
    }
    return [...grouped.entries()].map(([name, skillNames]) => recordSkillBundle(engine, {
      name,
      skillNames,
      source: "character-card-import",
      agentId,
      sourcePackage: plan.packageName,
    })).filter(Boolean);
  }

  function resolvePlanAsset(token, assetKey) {
    const plan = loadPlan(token);
    const asset = plan.assets[assetKey];
    if (!asset) throw new CharacterCardError("asset not found", 404);
    const filePath = path.join(plan.packageRoot, asset.rel);
    const rel = relativePathInsideBase(filePath, plan.packageRoot);
    if (rel === null || !fs.existsSync(filePath)) throw new CharacterCardError("asset not found", 404);
    return { filePath, mime: asset.mime };
  }

  function resolveExportAsset(agentId, assetKey) {
    if (!agentId) throw new CharacterCardError("agentId is required");
    const source = readAgentExportSource(agentId);
    const filePath = exportAssetSources(source)[assetKey];
    if (!filePath || !fs.existsSync(filePath)) throw new CharacterCardError("asset not found", 404);
    return { filePath, mime: mimeForImage(filePath) };
  }

  return {
    createImportPlanFromPath,
    commitImportPlan,
    createExportPreview,
    exportAgentPackage,
    resolvePlanAsset,
    resolveExportAsset,
  };
}

export { CharacterCardError };
