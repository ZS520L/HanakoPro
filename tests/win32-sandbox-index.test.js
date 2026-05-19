import { afterEach, describe, expect, it, vi } from "vitest";

const originalPlatform = process.platform;
const createWin32Exec = vi.fn(() => vi.fn(async () => ({ exitCode: 0 })));

vi.mock("../lib/sandbox/win32-exec.js", () => ({
  createWin32Exec,
}));

vi.mock("../lib/pi-sdk/index.js", () => {
  const makeTool = (name) => ({ name, execute: vi.fn(async () => ({ content: [] })) });
  return {
    createReadTool: vi.fn(() => makeTool("read")),
    createWriteTool: vi.fn(() => makeTool("write")),
    createEditTool: vi.fn(() => makeTool("edit")),
    createBashTool: vi.fn((_cwd, opts = {}) => ({ name: "bash", execute: opts.operations?.exec || vi.fn() })),
    createGrepTool: vi.fn(() => makeTool("grep")),
    createFindTool: vi.fn(() => makeTool("find")),
    createLsTool: vi.fn(() => makeTool("ls")),
  };
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.resetModules();
  vi.clearAllMocks();
});

describe("createSandboxedTools on Windows", () => {
  it("constructs a sandboxed AppContainer exec plus an unsandboxed fallback exec", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const { createSandboxedTools } = await import("../lib/sandbox/index.js");

    const getExternalReadPaths = () => ["C:\\outside\\brief.md"];
    const getSandboxNetworkEnabled = () => true;
    createSandboxedTools("C:\\work", [], {
      agentDir: "C:\\hana\\agents\\hana",
      workspace: "C:\\work",
      workspaceFolders: [],
      hanakoHome: "C:\\hana",
      getSandboxEnabled: () => true,
      getSandboxNetworkEnabled,
      getExternalReadPaths,
    });

    expect(createWin32Exec).toHaveBeenCalledWith();
    expect(createWin32Exec).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: expect.objectContaining({
        policy: expect.objectContaining({ mode: "standard" }),
        getExternalReadPaths,
        getSandboxNetworkEnabled,
      }),
    }));
  });
});
