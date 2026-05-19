import { describe, it, expect, vi } from "vitest";
import {
  McpRuntime,
  createMcpToolDefinition,
  isMcpToolEnabledForAgentConfig,
  normalizeMcpConfig,
  toMcpToolId,
} from "../plugins/mcp/lib/mcp-runtime.js";

describe("MCP runtime policy", () => {
  it("uses stable sanitized tool ids for dynamic MCP tools", () => {
    expect(toMcpToolId("github.com", "search/repositories")).toBe("github_com_search_repositories");
  });

  it("requires global, server, and tool-level agent enablement before exposing a tool", () => {
    const enabledAgent = {
      mcp: {
        connectors: {
          github: {
            enabled: true,
            tools: { search: true },
          },
        },
      },
    };

    expect(isMcpToolEnabledForAgentConfig(enabledAgent, {
      globalEnabled: true,
      serverId: "github",
      toolName: "search",
    })).toBe(true);

    expect(isMcpToolEnabledForAgentConfig(enabledAgent, {
      globalEnabled: false,
      serverId: "github",
      toolName: "search",
    })).toBe(false);

    expect(isMcpToolEnabledForAgentConfig({
      mcp: { connectors: { github: { enabled: false, tools: { search: true } } } },
    }, {
      globalEnabled: true,
      serverId: "github",
      toolName: "search",
    })).toBe(false);

    expect(isMcpToolEnabledForAgentConfig({
      mcp: { connectors: { github: { enabled: true, tools: { search: false } } } },
    }, {
      globalEnabled: true,
      serverId: "github",
      toolName: "search",
    })).toBe(false);
  });

  it("keeps backward compatibility with the previous mcp.servers agent config shape", () => {
    expect(isMcpToolEnabledForAgentConfig({
      mcp: { servers: { github: { enabled: true, tools: { search: true } } } },
    }, {
      globalEnabled: true,
      serverId: "github",
      toolName: "search",
    })).toBe(true);
  });

  it("normalizes remote connectors as the primary config shape", () => {
    const config = normalizeMcpConfig({
      enabled: true,
      connectors: [
        {
          id: "github.com",
          name: "GitHub",
          url: "https://mcp.github.com/mcp",
          authType: "bearer",
          authorizationToken: "token-123",
          tools: [{ name: "search", description: "Search repositories" }],
        },
      ],
    });

    expect(config.enabled).toBe(true);
    expect(config.connectors[0]).toMatchObject({
      id: "github_com",
      name: "GitHub",
      transport: "remote",
      url: "https://mcp.github.com/mcp",
      authType: "bearer",
      authorizationToken: "token-123",
    });
    expect(config.servers).toEqual(config.connectors);
  });

  it("normalizes Cherry-style MCP server fields into Hana connectors", () => {
    const config = normalizeMcpConfig({
      enabled: true,
      connectors: [
        {
          id: "cherry-http",
          name: "Cherry HTTP",
          type: "streamableHttp",
          baseUrl: "https://mcp.example.com/mcp",
          description: "Remote MCP server",
          headers: {
            Authorization: "Bearer header-token",
            "X-API-Key": "key-123",
          },
          timeout: "45",
          isActive: true,
        },
        {
          id: "cherry-stdio",
          name: "Cherry Stdio",
          type: "stdio",
          command: "npx",
          args: ["-y", "mcp-server-example"],
          env: { API_KEY: "secret" },
          registryUrl: "https://registry.npmmirror.com",
          autoStart: true,
        },
      ],
    });

    expect(config.connectors[0]).toMatchObject({
      id: "cherry-http",
      transport: "streamable-http",
      url: "https://mcp.example.com/mcp",
      description: "Remote MCP server",
      headers: {
        Authorization: "Bearer header-token",
        "X-API-Key": "key-123",
      },
      timeout: 45,
      autoStart: true,
    });
    expect(config.connectors[1]).toMatchObject({
      id: "cherry-stdio",
      transport: "stdio",
      command: "npx",
      env: { API_KEY: "secret" },
      registryUrl: "https://registry.npmmirror.com",
      autoStart: true,
    });
  });

  it("migrates the earlier local server config into connectors", () => {
    const config = normalizeMcpConfig({
      servers: [
        {
          id: "local-github",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      ],
    });

    expect(config.connectors[0]).toMatchObject({
      id: "local-github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });
    expect(config.servers).toEqual(config.connectors);
  });

  it("returns connector state and a servers alias for API compatibility", () => {
    const stored = {
      enabled: true,
      connectors: [
        {
          id: "github",
          name: "GitHub",
          url: "https://mcp.github.com/mcp",
          tools: [{ name: "search" }],
        },
      ],
    };
    const runtime = new McpRuntime({
      dataDir: "/tmp/mcp-test",
      config: {
        get: vi.fn(() => stored),
        set: vi.fn(),
      },
      registerTool: vi.fn(() => () => {}),
      bus: { request: vi.fn() },
      log: console,
    });

    const state = runtime.getState({
      mcp: {
        connectors: {
          github: { enabled: true, tools: { search: true } },
        },
      },
    });

    expect(state.connectors[0]).toMatchObject({
      id: "github",
      transport: "remote",
      status: "stopped",
    });
    expect(state.servers).toEqual(state.connectors);
    expect(state.agentConfig).toEqual({
      connectors: {
        github: { enabled: true, tools: { search: true } },
      },
      servers: {
        github: { enabled: true, tools: { search: true } },
      },
    });
  });

  it("redacts connector secrets from public state without dropping their keys", () => {
    const stored = {
      enabled: true,
      connectors: [
        {
          id: "private",
          name: "Private",
          command: "npx",
          env: {
            BASE_URL: "https://internal.example.com",
            API_KEY: "secret",
          },
          headers: {
            Authorization: "Bearer secret",
            "X-Trace": "trace-id",
          },
          authorizationToken: "token-123",
          oauthClientSecret: "client-secret",
        },
      ],
    };
    const runtime = new McpRuntime({
      dataDir: "/tmp/mcp-test",
      config: {
        get: vi.fn(() => stored),
        set: vi.fn(),
      },
      registerTool: vi.fn(() => () => {}),
      bus: { request: vi.fn() },
      log: console,
    });

    const [connector] = runtime.getState().connectors;

    expect(connector.env).toEqual({
      BASE_URL: "********",
      API_KEY: "********",
    });
    expect(connector.headers).toEqual({
      Authorization: "********",
      "X-Trace": "********",
    });
    expect(connector.authorizationToken).toBe("********");
    expect(connector.oauthClientSecret).toBe("********");
  });

  it("returns an explicit tool error when MCP is globally disabled at call time", async () => {
    const callTool = vi.fn();
    const tool = createMcpToolDefinition({
      serverId: "github",
      toolName: "search",
      description: "Search repositories",
      inputSchema: { type: "object", properties: {} },
      getGlobalEnabled: () => false,
      getAgentConfig: () => ({
        mcp: { connectors: { github: { enabled: true, tools: { search: true } } } },
      }),
      callTool,
    });

    const result = await tool.execute({}, { agentId: "hana" });

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toMatch(/MCP is disabled/);
  });

  it("returns an explicit tool error when the per-agent MCP tool switch is off", async () => {
    const callTool = vi.fn();
    const tool = createMcpToolDefinition({
      serverId: "github",
      toolName: "search",
      description: "Search repositories",
      inputSchema: { type: "object", properties: {} },
      getGlobalEnabled: () => true,
      getAgentConfig: () => ({
        mcp: { connectors: { github: { enabled: true, tools: { search: false } } } },
      }),
      callTool,
    });

    const result = await tool.execute({}, { agentId: "hana" });

    expect(callTool).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toMatch(/not enabled for this agent/);
  });
});
