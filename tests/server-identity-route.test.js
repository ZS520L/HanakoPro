import { Hono } from "hono";
import { describe, expect, it, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-server-identity-route-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function writeValidIdentity(root) {
  writeJson(path.join(root, "server-node.json"), {
    schemaVersion: 1,
    serverId: "server_route",
    label: "Route Server",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  });
  writeJson(path.join(root, "users.json"), {
    schemaVersion: 1,
    defaultUserId: "user_route",
    users: [{
      userId: "user_route",
      kind: "legacy_owner",
      displayName: "Route User",
      profileSource: "legacy_user_profile",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    }],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  });
  writeJson(path.join(root, "spaces.json"), {
    schemaVersion: 1,
    defaultSpaceId: "space_route",
    spaces: [{
      spaceId: "space_route",
      ownerUserId: "user_route",
      label: "Route Space",
      kind: "personal",
      storage: { provider: "legacy_hana_home", legacyRoot: true },
      membershipModel: "single_user_implicit",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    }],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  });
}

describe("server identity route", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("returns token-protected local server identity metadata for the active legacy Space", async () => {
    tmpDir = makeTmpDir();
    writeValidIdentity(tmpDir);
    const { createServerIdentityRoute } = await import("../server/routes/server-identity.js");
    const app = new Hono();
    app.route("/api", createServerIdentityRoute({ hanakoHome: tmpDir, appVersion: "1.2.3" }));

    const res = await app.request("/api/server/identity");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serverId: "server_route",
      userId: "user_route",
      spaceId: "space_route",
      label: "Route Server",
      userLabel: "Route User",
      spaceLabel: "Route Space",
      trustState: "local",
      authState: "paired",
      capabilities: ["chat", "resources", "tools"],
      version: "1.2.3",
    });
  });

  it("returns an explicit error when registry files are invalid", async () => {
    tmpDir = makeTmpDir();
    writeValidIdentity(tmpDir);
    fs.writeFileSync(path.join(tmpDir, "spaces.json"), "{ bad json", "utf-8");
    const { createServerIdentityRoute } = await import("../server/routes/server-identity.js");
    const app = new Hono();
    app.route("/api", createServerIdentityRoute({ hanakoHome: tmpDir, appVersion: "1.2.3" }));

    const res = await app.request("/api/server/identity");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "invalid server identity registry",
      detail: expect.stringContaining("invalid spaces.json"),
    });
  });
});
