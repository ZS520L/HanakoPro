import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-server-identity-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function writeValidIdentity(root, overrides = {}) {
  const serverNode = {
    schemaVersion: 1,
    serverId: "server_test",
    label: "Test Server",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...(overrides.serverNode || {}),
  };
  const users = {
    schemaVersion: 1,
    defaultUserId: "user_test",
    users: [{
      userId: "user_test",
      kind: "legacy_owner",
      displayName: "Test User",
      profileSource: "legacy_user_profile",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    }],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...(overrides.users || {}),
  };
  const spaces = {
    schemaVersion: 1,
    defaultSpaceId: "space_test",
    spaces: [{
      spaceId: "space_test",
      ownerUserId: "user_test",
      label: "Test Space",
      kind: "personal",
      storage: { provider: "legacy_hana_home", legacyRoot: true },
      membershipModel: "single_user_implicit",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    }],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    ...(overrides.spaces || {}),
  };
  writeJson(path.join(root, "server-node.json"), serverNode);
  writeJson(path.join(root, "users.json"), users);
  writeJson(path.join(root, "spaces.json"), spaces);
}

describe("server identity loader", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("loads the active local server/user/space identity from registry files", async () => {
    tmpDir = makeTmpDir();
    writeValidIdentity(tmpDir);
    const { loadServerIdentity } = await import("../core/server-identity.js");

    expect(loadServerIdentity(tmpDir)).toEqual({
      serverId: "server_test",
      userId: "user_test",
      spaceId: "space_test",
      label: "Test Server",
      userLabel: "Test User",
      spaceLabel: "Test Space",
      userKind: "legacy_owner",
      spaceKind: "personal",
      membershipModel: "single_user_implicit",
      storage: { provider: "legacy_hana_home", legacyRoot: true },
    });
  });

  it("throws when identity registry files are missing instead of creating them at runtime", async () => {
    tmpDir = makeTmpDir();
    const { loadServerIdentity } = await import("../core/server-identity.js");

    expect(() => loadServerIdentity(tmpDir)).toThrow("server-node.json not found");
  });

  it("throws when the default space owner does not match the default user", async () => {
    tmpDir = makeTmpDir();
    writeValidIdentity(tmpDir, {
      spaces: {
        spaces: [{
          spaceId: "space_test",
          ownerUserId: "user_other",
          label: "Test Space",
          kind: "personal",
          storage: { provider: "legacy_hana_home", legacyRoot: true },
          membershipModel: "single_user_implicit",
        }],
      },
    });
    const { loadServerIdentity } = await import("../core/server-identity.js");

    expect(() => loadServerIdentity(tmpDir))
      .toThrow("default Space ownerUserId must reference an existing user");
  });
});
