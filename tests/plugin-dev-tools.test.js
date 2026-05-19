import { describe, expect, it, vi } from "vitest";
import { createPluginDevTools } from "../core/plugin-dev-tools.js";

describe("createPluginDevTools", () => {
  it("wraps dev lifecycle operations as Agent-callable tools", async () => {
    const service = {
      installFromSource: vi.fn(async () => ({ ok: true, plugin: { id: "demo" } })),
      reloadPlugin: vi.fn(),
      enablePlugin: vi.fn(),
      disablePlugin: vi.fn(),
      resetPlugin: vi.fn(),
      uninstallPlugin: vi.fn(),
      invokeTool: vi.fn(),
      getDiagnostics: vi.fn(),
      listSurfaces: vi.fn(),
      describeSurfaceDebug: vi.fn(),
      runScenario: vi.fn(),
    };
    const tools = createPluginDevTools({ pluginDevService: service });
    const install = tools.find((tool) => tool.name === "plugin_dev_install");

    expect(tools.map((tool) => tool.name)).toContain("plugin_dev_uninstall");
    const result = await install.execute("call-1", {
      sourcePath: "/workspace/demo",
      pluginId: "demo",
      allowFullAccess: true,
    });

    expect(service.installFromSource).toHaveBeenCalledWith({
      sourcePath: "/workspace/demo",
      pluginId: "demo",
      allowFullAccess: true,
    });
    expect(result.details).toMatchObject({ ok: true, plugin: { id: "demo" } });
  });

  it("passes session and agent context to dev plugin tool invocations", async () => {
    const service = {
      installFromSource: vi.fn(),
      reloadPlugin: vi.fn(),
      enablePlugin: vi.fn(),
      disablePlugin: vi.fn(),
      resetPlugin: vi.fn(),
      uninstallPlugin: vi.fn(),
      invokeTool: vi.fn(async () => ({ ok: true })),
      getDiagnostics: vi.fn(),
      listSurfaces: vi.fn(),
      describeSurfaceDebug: vi.fn(),
      runScenario: vi.fn(),
    };
    const tools = createPluginDevTools({
      pluginDevService: service,
      getAgentId: () => "hanako",
    });
    const invoke = tools.find((tool) => tool.name === "plugin_dev_invoke_tool");

    await invoke.execute(
      "call-1",
      { pluginId: "demo", toolName: "echo", input: { text: "hi" } },
      null,
      null,
      { sessionManager: { getSessionFile: () => "/tmp/session.jsonl" } },
    );

    expect(service.invokeTool).toHaveBeenCalledWith({
      pluginId: "demo",
      toolName: "echo",
      input: { text: "hi" },
      sessionPath: "/tmp/session.jsonl",
      agentId: "hanako",
    });
  });
});
