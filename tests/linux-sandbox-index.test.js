import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sandbox/platform.js", () => ({
  detectPlatform: vi.fn(() => "bwrap"),
  checkAvailability: vi.fn(() => false),
}));

vi.mock("../lib/pi-sdk/index.js", () => {
  const makeTool = (name) => ({ name, execute: vi.fn(async () => ({ content: [] })) });
  return {
    createReadTool: vi.fn(() => makeTool("read")),
    createWriteTool: vi.fn(() => makeTool("write")),
    createEditTool: vi.fn(() => makeTool("edit")),
    createBashTool: vi.fn((cwd, opts = {}) => ({
      name: "bash",
      execute: vi.fn(async (_toolCallId, params) => {
        if (opts.operations?.exec) {
          return opts.operations.exec(params.command, cwd, {});
        }
        return { content: [{ type: "text", text: "direct bash" }] };
      }),
    })),
    createGrepTool: vi.fn(() => makeTool("grep")),
    createFindTool: vi.fn(() => makeTool("find")),
    createLsTool: vi.fn(() => makeTool("ls")),
  };
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("createSandboxedTools on Linux", () => {
  it("fails closed for bash when bwrap is unavailable while sandbox remains enabled", async () => {
    const { createSandboxedTools } = await import("../lib/sandbox/index.js");
    const result = createSandboxedTools("/work", [], {
      agentDir: "/hana/agents/hana",
      workspace: "/work",
      workspaceFolders: [],
      hanakoHome: "/hana",
      getSandboxEnabled: () => true,
    });

    const bash = result.tools.find((tool) => tool.name === "bash");
    const output = await bash.execute("call-1", { command: "pwd" });

    expect(output.content[0].text).not.toBe("direct bash");
    expect(output.content[0].text).toMatch(/bwrap|sandbox|沙盒|系统/);
  });

  it("uses the direct bash fallback when the user explicitly disables sandbox", async () => {
    const { createSandboxedTools } = await import("../lib/sandbox/index.js");
    const result = createSandboxedTools("/work", [], {
      agentDir: "/hana/agents/hana",
      workspace: "/work",
      workspaceFolders: [],
      hanakoHome: "/hana",
      getSandboxEnabled: () => false,
    });

    const bash = result.tools.find((tool) => tool.name === "bash");
    const output = await bash.execute("call-2", { command: "pwd" });

    expect(output.content[0].text).toBe("direct bash");
  });
});
