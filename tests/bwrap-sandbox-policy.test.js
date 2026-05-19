import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBwrapArgs } from "../lib/sandbox/bwrap.js";

function hasMount(args, op, source, target) {
  for (let i = 0; i < args.length - 2; i += 1) {
    if (args[i] === op && args[i + 1] === source && args[i + 2] === target) return true;
  }
  return false;
}

function hasRootReadonlyMount(args) {
  return hasMount(args, "--ro-bind", "/", "/");
}

describe("Linux bwrap sandbox policy projection", () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bwrap-policy-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("uses explicit allowlist mounts instead of exposing the whole host filesystem", () => {
    const workspace = path.join(tempRoot, "workspace");
    const agentSessions = path.join(tempRoot, "hanako", "agents", "hana", "sessions");
    const sessionFiles = path.join(tempRoot, "hanako", "session-files");
    const externalFile = path.join(tempRoot, "outside.md");
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(agentSessions, { recursive: true });
    fs.mkdirSync(sessionFiles, { recursive: true });
    fs.writeFileSync(externalFile, "outside");

    const args = buildBwrapArgs({
      mode: "standard",
      writablePaths: [workspace, agentSessions],
      readablePaths: [sessionFiles],
      protectedPaths: [path.join(workspace, ".git"), sessionFiles],
      denyReadPaths: [],
    }, {
      env: { HOME: path.join(tempRoot, "home") },
      externalReadPaths: [externalFile],
    });

    expect(hasRootReadonlyMount(args)).toBe(false);
    expect(args).toContain("--unshare-net");
    expect(hasMount(args, "--bind", workspace, workspace)).toBe(true);
    expect(hasMount(args, "--bind", agentSessions, agentSessions)).toBe(true);
    expect(hasMount(args, "--ro-bind", sessionFiles, sessionFiles)).toBe(true);
    expect(hasMount(args, "--ro-bind", externalFile, externalFile)).toBe(true);
  });

  it("keeps network isolated by default and omits net namespace isolation when sandbox network is allowed", () => {
    const policy = {
      mode: "standard",
      writablePaths: [],
      readablePaths: [],
      protectedPaths: [],
      denyReadPaths: [],
    };

    expect(buildBwrapArgs(policy)).toContain("--unshare-net");
    expect(buildBwrapArgs(policy, { allowNetwork: true })).not.toContain("--unshare-net");
  });
});
