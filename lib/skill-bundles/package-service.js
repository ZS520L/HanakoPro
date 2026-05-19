import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { safeCopyDir } from "../../shared/safe-fs.js";
import { writeZipFromDirectory } from "../zip-writer.js";
import { sanitizeSkillName } from "../tools/install-skill.js";
import { loadSkillBundleStore } from "./store.js";

const SCHEMA_VERSION = 1;

export class SkillBundlePackageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SkillBundlePackageError";
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value) {
  return String(value || "skill-bundle")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "skill-bundle";
}

function exportFileNameForBundle(bundleName) {
  return `${slugify(bundleName)}-skillbundle.zip`;
}

function resolveUniqueExportPath(targetDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(targetDir, fileName);
  for (let attempt = 2; fs.existsSync(candidate); attempt++) {
    candidate = path.join(targetDir, `${parsed.name}-${attempt}${parsed.ext}`);
  }
  return candidate;
}

function resolveDefaultExportTargetDir(engine) {
  const candidates = [engine?.cwd, engine?.hanakoHome].filter(Boolean);
  const targetDir = candidates.find(candidate => path.isAbsolute(candidate));
  if (!targetDir) throw new SkillBundlePackageError("export target directory is not available", 500);
  return targetDir;
}

function pathInsideBase(filePath, baseDir) {
  if (!filePath || !baseDir) return false;
  const rel = path.relative(path.resolve(baseDir), path.resolve(filePath));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function parseSkillName(skillMdPath) {
  try {
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
      if (nameMatch) return nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }
    const headingMatch = content.match(/^#\s+(.+?)$/m);
    return headingMatch ? headingMatch[1].trim() : null;
  } catch {
    return null;
  }
}

function ensureNoSymlinks(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        throw new SkillBundlePackageError(`skill contains symlink: ${entry.name}`, 400);
      }
      if (stat.isDirectory()) stack.push(full);
    }
  }
}

function buildSkillIndex(engine) {
  const byName = new Map();
  let skills = [];
  try {
    skills = engine.getAllSkills?.() || [];
  } catch {
    skills = [];
  }
  for (const skill of skills) {
    const name = trimString(skill?.name);
    if (name) byName.set(name, skill);
  }
  return byName;
}

function candidateSkillDirs(engine, skillName, skillIndex) {
  const candidates = [];
  const skill = skillIndex.get(skillName);
  if (skill?.baseDir) candidates.push(skill.baseDir);
  if (skill?.filePath) candidates.push(path.dirname(skill.filePath));
  for (const base of [engine.userSkillsDir, engine.skillsDir]) {
    if (base) candidates.push(path.join(base, skillName));
  }
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function resolveExportableSkillDir(engine, skillName, skillIndex) {
  const allowedRoots = [engine.userSkillsDir, engine.skillsDir]
    .filter(Boolean)
    .map(root => path.resolve(root));
  for (const candidate of candidateSkillDirs(engine, skillName, skillIndex)) {
    if (!allowedRoots.some(root => pathInsideBase(candidate, root))) continue;
    const skillMdPath = path.join(candidate, "SKILL.md");
    if (fs.existsSync(skillMdPath) && fs.statSync(skillMdPath).isFile()) {
      return candidate;
    }
  }
  return null;
}

function loadBundle(engine, bundleId) {
  const id = trimString(bundleId);
  if (!id) throw new SkillBundlePackageError("bundle id is required", 400);
  const store = loadSkillBundleStore(engine);
  const bundle = store.bundles.find(item => item.id === id);
  if (!bundle) throw new SkillBundlePackageError("skill bundle not found", 404);
  return bundle;
}

function buildManifest(bundle, exportedSkills, fileName) {
  return {
    kind: "SkillBundle",
    schemaVersion: SCHEMA_VERSION,
    package: {
      name: fileName,
      exportedAt: nowIso(),
    },
    bundle: {
      name: bundle.name,
      source: bundle.source || "user",
      sourcePackage: bundle.sourcePackage || null,
    },
    skills: {
      bundles: [
        {
          name: bundle.name,
          skills: exportedSkills.map(skill => ({
            name: skill.name,
            path: skill.path,
          })),
        },
      ],
    },
  };
}

export async function exportSkillBundlePackage(engine, bundleId, options = {}) {
  const bundle = loadBundle(engine, bundleId);
  const targetDir = options.targetDir || resolveDefaultExportTargetDir(engine);
  if (!path.isAbsolute(targetDir)) {
    throw new SkillBundlePackageError("export target directory must be absolute", 400);
  }
  await fsp.mkdir(targetDir, { recursive: true });

  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const exportRoot = path.join(engine.hanakoHome, ".ephemeral", "skill-bundle-exports", token);
  const packageRoot = path.join(exportRoot, "package");
  const skillIndex = buildSkillIndex(engine);
  const exportedSkills = [];
  const warnings = [];

  try {
    await fsp.mkdir(path.join(packageRoot, "skills"), { recursive: true });
    for (const skillName of bundle.skillNames) {
      const safeName = sanitizeSkillName(skillName);
      const sourceDir = safeName ? resolveExportableSkillDir(engine, skillName, skillIndex) : null;
      if (!safeName || !sourceDir) {
        warnings.push({ type: "missing-skill", name: skillName });
        continue;
      }
      ensureNoSymlinks(sourceDir);
      const targetRel = `skills/${safeName}`;
      safeCopyDir(sourceDir, path.join(packageRoot, targetRel));
      const exportedName = parseSkillName(path.join(sourceDir, "SKILL.md")) || skillName;
      exportedSkills.push({ name: sanitizeSkillName(exportedName) || safeName, path: targetRel });
    }

    if (exportedSkills.length === 0) {
      throw new SkillBundlePackageError("skill bundle has no exportable skills", 400);
    }

    const fileName = exportFileNameForBundle(bundle.name);
    const filePath = resolveUniqueExportPath(targetDir, fileName);
    const resolvedFileName = path.basename(filePath);
    await fsp.writeFile(
      path.join(packageRoot, "bundle.json"),
      JSON.stringify(buildManifest(bundle, exportedSkills, resolvedFileName), null, 2) + "\n",
      "utf-8",
    );

    await writeZipFromDirectory(packageRoot, filePath);
    return {
      ok: true,
      filePath,
      fileName: resolvedFileName,
      bundle: {
        id: bundle.id,
        name: bundle.name,
        skillCount: exportedSkills.length,
      },
      warnings,
    };
  } finally {
    await fsp.rm(exportRoot, { recursive: true, force: true }).catch(() => {});
  }
}
