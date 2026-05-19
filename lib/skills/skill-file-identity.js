import path from "path";

export const SKILL_SOURCE_IDENTITY_VERSION = 1;
export const SKILL_SNAPSHOT_SOURCE_SIDECAR = ".hana-skill-source.json";

const EDITABLE_SOURCE_OWNERS = new Set(["user", "learned", "workspace"]);

export function inferSkillSourceOwner(skill = {}) {
  if (skill.sourceIdentity?.owner) return skill.sourceIdentity.owner;
  if (skill._pluginSkill || skill._externalLabel?.startsWith?.("plugin:")) return "plugin";
  if (skill._workspaceSkill || skill._managedBy === "workspace") return "workspace";
  if (skill.source === "learned") return "learned";
  if (skill.source === "external") return "external";
  if (skill.source === "builtin") return "builtin";
  if (skill.source === "user") return "user";
  if (skill.sourceInfo?.source === "builtin") return "builtin";
  if (skill.sourceInfo?.source === "plugin") return "plugin";
  return "user";
}

export function isEditableSkillSourceOwner(owner) {
  return EDITABLE_SOURCE_OWNERS.has(owner);
}

export function createSkillSourceIdentity({
  owner,
  skillName,
  filePath,
  baseDir,
  editable = isEditableSkillSourceOwner(owner),
} = {}) {
  const resolvedFilePath = filePath ? path.resolve(filePath) : null;
  const resolvedBaseDir = baseDir
    ? path.resolve(baseDir)
    : (resolvedFilePath ? path.dirname(resolvedFilePath) : null);
  const canEdit = editable === true;
  return {
    kind: "skill_source",
    owner: owner || "unknown",
    skillName: skillName || "",
    filePath: resolvedFilePath,
    baseDir: resolvedBaseDir,
    editable: canEdit,
    readonly: !canEdit,
  };
}

export function sourceIdentityForSkill(skill = {}, overrides = {}) {
  if (skill.sourceIdentity && !overrides.filePath && !overrides.baseDir && !overrides.owner) {
    return { ...skill.sourceIdentity };
  }
  const filePath = overrides.filePath || skill.sourceIdentity?.filePath || skill.filePath || null;
  const baseDir = overrides.baseDir || skill.sourceIdentity?.baseDir || skill.baseDir || (filePath ? path.dirname(filePath) : null);
  const owner = overrides.owner || skill.sourceIdentity?.owner || inferSkillSourceOwner(skill);
  const editable = Object.prototype.hasOwnProperty.call(overrides, "editable")
    ? overrides.editable
    : (skill.sourceIdentity?.editable ?? isEditableSkillSourceOwner(owner));
  return createSkillSourceIdentity({
    owner,
    skillName: overrides.skillName || skill.sourceIdentity?.skillName || skill.name || "",
    filePath,
    baseDir,
    editable,
  });
}

export function createSkillSnapshotIdentity({ filePath, baseDir } = {}) {
  const resolvedFilePath = filePath ? path.resolve(filePath) : null;
  const resolvedBaseDir = baseDir
    ? path.resolve(baseDir)
    : (resolvedFilePath ? path.dirname(resolvedFilePath) : null);
  return {
    kind: "skill_snapshot",
    filePath: resolvedFilePath,
    baseDir: resolvedBaseDir,
    readonly: true,
  };
}

export function createSkillPointerIdentity({ filePath, baseDir } = {}) {
  const resolvedFilePath = filePath ? path.resolve(filePath) : null;
  const resolvedBaseDir = baseDir
    ? path.resolve(baseDir)
    : (resolvedFilePath ? path.dirname(resolvedFilePath) : null);
  return {
    kind: "skill_pointer",
    filePath: resolvedFilePath,
    baseDir: resolvedBaseDir,
    readonly: true,
  };
}

export function createSkillSnapshotSourceSidecar({ skillName, source, snapshot } = {}) {
  return {
    version: SKILL_SOURCE_IDENTITY_VERSION,
    kind: "skill_snapshot_source",
    skillName: skillName || source?.skillName || "",
    source,
    snapshot,
  };
}
