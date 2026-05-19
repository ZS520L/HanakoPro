import fs from "fs";
import path from "path";
import crypto from "crypto";

const SERVER_NODE_FILE = "server-node.json";
const USERS_FILE = "users.json";
const SPACES_FILE = "spaces.json";

export function loadServerIdentity(hanakoHome) {
  const serverNode = readRequiredIdentityJson(path.join(hanakoHome, SERVER_NODE_FILE), SERVER_NODE_FILE);
  const users = readRequiredIdentityJson(path.join(hanakoHome, USERS_FILE), USERS_FILE);
  const spaces = readRequiredIdentityJson(path.join(hanakoHome, SPACES_FILE), SPACES_FILE);

  validateServerNodeIdentity(serverNode, SERVER_NODE_FILE);
  validateUsersIdentity(users, USERS_FILE);
  validateSpacesIdentity(spaces, SPACES_FILE);
  validateIdentityRegistryLinks(users, spaces);

  const defaultUser = users.users.find((user) => user.userId === users.defaultUserId);
  const defaultSpace = getDefaultSpace(spaces);

  return {
    serverId: serverNode.serverId,
    userId: defaultUser.userId,
    spaceId: defaultSpace.spaceId,
    label: serverNode.label,
    userLabel: defaultUser.displayName,
    spaceLabel: defaultSpace.label,
    userKind: defaultUser.kind,
    spaceKind: defaultSpace.kind,
    membershipModel: defaultSpace.membershipModel,
    storage: defaultSpace.storage || null,
  };
}

export function ensureLocalIdentityRegistries(hanakoHome) {
  const serverNodePath = path.join(hanakoHome, SERVER_NODE_FILE);
  const usersPath = path.join(hanakoHome, USERS_FILE);
  const spacesPath = path.join(hanakoHome, SPACES_FILE);

  const existingServerNode = readIdentityJsonIfPresent(serverNodePath, SERVER_NODE_FILE);
  const existingUsers = readIdentityJsonIfPresent(usersPath, USERS_FILE);
  const existingSpaces = readIdentityJsonIfPresent(spacesPath, SPACES_FILE);

  if (existingServerNode) validateServerNodeIdentity(existingServerNode, SERVER_NODE_FILE);
  if (existingUsers) validateUsersIdentity(existingUsers, USERS_FILE);
  if (existingSpaces) validateSpacesIdentity(existingSpaces, SPACES_FILE);
  if (existingUsers && existingSpaces) validateIdentityRegistryLinks(existingUsers, existingSpaces);

  const now = new Date().toISOString();
  const users = existingUsers || createLegacyUsersIdentity({
    userId: existingSpaces ? getDefaultSpace(existingSpaces).ownerUserId : undefined,
    now,
  });
  const spaces = existingSpaces || createLegacySpacesIdentity({
    ownerUserId: users.defaultUserId,
    now,
  });
  const serverNode = existingServerNode || createLocalServerNodeIdentity({ now });

  validateIdentityRegistryLinks(users, spaces);

  if (!existingServerNode) writeJsonAtomic(serverNodePath, serverNode);
  if (!existingUsers) writeJsonAtomic(usersPath, users);
  if (!existingSpaces) writeJsonAtomic(spacesPath, spaces);

  return {
    created: [
      !existingServerNode ? SERVER_NODE_FILE : null,
      !existingUsers ? USERS_FILE : null,
      !existingSpaces ? SPACES_FILE : null,
    ].filter(Boolean),
  };
}

function readRequiredIdentityJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`${label} not found`);
    if (err instanceof SyntaxError) throw new Error(`invalid ${label}: ${err.message}`);
    throw new Error(`failed to read ${label}: ${err.message}`);
  }
}

function readIdentityJsonIfPresent(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    if (err instanceof SyntaxError) throw new Error(`invalid ${label}: ${err.message}`);
    throw new Error(`failed to read ${label}: ${err.message}`);
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
}

function createLocalServerNodeIdentity({ now }) {
  return {
    schemaVersion: 1,
    serverId: `server_${crypto.randomUUID()}`,
    label: "Local Hana",
    createdAt: now,
    updatedAt: now,
  };
}

function createLegacyUsersIdentity({ userId, now }) {
  const resolvedUserId = userId || `user_${crypto.randomUUID()}`;
  return {
    schemaVersion: 1,
    defaultUserId: resolvedUserId,
    users: [{
      userId: resolvedUserId,
      kind: "legacy_owner",
      displayName: "Local User",
      profileSource: "legacy_user_profile",
      createdAt: now,
      updatedAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function createLegacySpacesIdentity({ ownerUserId, now }) {
  const spaceId = `space_${crypto.randomUUID()}`;
  return {
    schemaVersion: 1,
    defaultSpaceId: spaceId,
    spaces: [{
      spaceId,
      ownerUserId,
      label: "Personal Space",
      kind: "personal",
      storage: {
        provider: "legacy_hana_home",
        legacyRoot: true,
      },
      membershipModel: "single_user_implicit",
      createdAt: now,
      updatedAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function validateServerNodeIdentity(value, label) {
  if (!isPlainObject(value)) throw new Error(`invalid ${label}: expected object`);
  if (value.schemaVersion !== 1) throw new Error(`invalid ${label}: schemaVersion must be 1`);
  if (!isNonEmptyString(value.serverId)) throw new Error(`invalid ${label}: serverId required`);
  if (!isNonEmptyString(value.label)) throw new Error(`invalid ${label}: label required`);
}

function validateUsersIdentity(value, label) {
  if (!isPlainObject(value)) throw new Error(`invalid ${label}: expected object`);
  if (value.schemaVersion !== 1) throw new Error(`invalid ${label}: schemaVersion must be 1`);
  if (!isNonEmptyString(value.defaultUserId)) throw new Error(`invalid ${label}: defaultUserId required`);
  if (!Array.isArray(value.users) || value.users.length === 0) {
    throw new Error(`invalid ${label}: users must be a non-empty array`);
  }
  const seen = new Set();
  for (const user of value.users) {
    if (!isPlainObject(user)) throw new Error(`invalid ${label}: user must be object`);
    if (!isNonEmptyString(user.userId)) throw new Error(`invalid ${label}: userId required`);
    if (seen.has(user.userId)) throw new Error(`invalid ${label}: duplicate userId ${user.userId}`);
    seen.add(user.userId);
    if (!isNonEmptyString(user.kind)) throw new Error(`invalid ${label}: user.kind required`);
    if (!isNonEmptyString(user.displayName)) throw new Error(`invalid ${label}: user.displayName required`);
  }
  if (!seen.has(value.defaultUserId)) {
    throw new Error(`invalid ${label}: defaultUserId must reference an existing user`);
  }
}

function validateSpacesIdentity(value, label) {
  if (!isPlainObject(value)) throw new Error(`invalid ${label}: expected object`);
  if (value.schemaVersion !== 1) throw new Error(`invalid ${label}: schemaVersion must be 1`);
  if (!isNonEmptyString(value.defaultSpaceId)) throw new Error(`invalid ${label}: defaultSpaceId required`);
  if (!Array.isArray(value.spaces) || value.spaces.length === 0) {
    throw new Error(`invalid ${label}: spaces must be a non-empty array`);
  }
  const seen = new Set();
  for (const space of value.spaces) {
    if (!isPlainObject(space)) throw new Error(`invalid ${label}: space must be object`);
    if (!isNonEmptyString(space.spaceId)) throw new Error(`invalid ${label}: spaceId required`);
    if (seen.has(space.spaceId)) throw new Error(`invalid ${label}: duplicate spaceId ${space.spaceId}`);
    seen.add(space.spaceId);
    if (!isNonEmptyString(space.ownerUserId)) throw new Error(`invalid ${label}: ownerUserId required`);
    if (!isNonEmptyString(space.label)) throw new Error(`invalid ${label}: space.label required`);
    if (!isNonEmptyString(space.kind)) throw new Error(`invalid ${label}: space.kind required`);
    if (!isNonEmptyString(space.membershipModel)) throw new Error(`invalid ${label}: membershipModel required`);
  }
  if (!seen.has(value.defaultSpaceId)) {
    throw new Error(`invalid ${label}: defaultSpaceId must reference an existing space`);
  }
}

function validateIdentityRegistryLinks(users, spaces) {
  const userIds = new Set(users.users.map((user) => user.userId));
  const defaultSpace = getDefaultSpace(spaces);
  if (!userIds.has(defaultSpace.ownerUserId)) {
    throw new Error("invalid identity registries: default Space ownerUserId must reference an existing user");
  }
  if (defaultSpace.ownerUserId !== users.defaultUserId) {
    throw new Error("invalid identity registries: default Space ownerUserId must match defaultUserId");
  }
}

function getDefaultSpace(spaces) {
  return spaces.spaces.find((space) => space.spaceId === spaces.defaultSpaceId);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
