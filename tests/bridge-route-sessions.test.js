import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createBridgeRoute } from "../server/routes/bridge.js";

let rootDir;

function makeApp() {
  const agentId = "hana";
  const sessionDir = path.join(rootDir, "agents", agentId, "sessions");
  const bridgeDir = path.join(sessionDir, "bridge");
  const sessionPath = path.join(bridgeDir, "owner", "tg-owner.jsonl");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, "", "utf-8");

  const agent = {
    id: agentId,
    sessionDir,
    config: {
      bridge: {
        telegram: { owner: "owner" },
      },
    },
  };
  const engine = {
    currentAgentId: agentId,
    getAgent: (id) => (id === agentId ? agent : null),
    getBridgeIndex: () => ({
      "tg_dm_owner@hana": {
        file: "owner/tg-owner.jsonl",
        name: "Owner",
        avatarUrl: "https://example.com/avatar.png",
        userId: "owner",
        chatId: "owner",
      },
    }),
    getBridgeReadOnly: () => false,
    getBridgeReceiptEnabled: () => true,
  };

  const app = new Hono();
  app.route("/api", createBridgeRoute(engine, null));
  return { app, sessionPath };
}

describe("bridge sessions route", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bridge-route-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("returns the resolved sessionPath for ChatTranscript hydration", async () => {
    const { app, sessionPath } = makeApp();

    const res = await app.request("/api/bridge/sessions?platform=telegram&agentId=hana");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      sessionKey: "tg_dm_owner@hana",
      file: "owner/tg-owner.jsonl",
      sessionPath,
      displayName: "Owner",
      avatarUrl: "https://example.com/avatar.png",
    });
  });
});
