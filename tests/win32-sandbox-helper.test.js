import { describe, expect, it } from "vitest";
import { buildWin32SandboxHelperArgs } from "../lib/sandbox/win32-sandbox-helper.js";

describe("buildWin32SandboxHelperArgs", () => {
  it("emits requested AppContainer network capabilities only when requested", () => {
    const base = {
      cwd: "C:\\work",
      executable: "C:\\Hanako\\resources\\git\\bin\\bash.exe",
      args: ["-lc", "curl https://example.com"],
      grants: { writePaths: ["C:\\work"] },
    };

    expect(buildWin32SandboxHelperArgs(base)).not.toContain("--network");
    expect(buildWin32SandboxHelperArgs({
      ...base,
      network: {
        internetClient: true,
        internetClientServer: true,
        privateNetworkClientServer: true,
      },
    })).toEqual([
      "--cwd",
      "C:\\work",
      "--network",
      "internet-client",
      "--network",
      "internet-client-server",
      "--network",
      "private-network-client-server",
      "--grant-write",
      "C:\\work",
      "--",
      "C:\\Hanako\\resources\\git\\bin\\bash.exe",
      "-lc",
      "curl https://example.com",
    ]);
  });
});
