import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { McpStdioClient } from "../plugins/mcp/lib/mcp-stdio-client.js";

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = {
      end: vi.fn(),
      write: vi.fn((line) => {
        const message = JSON.parse(String(line));
        if (message.id == null) return true;
        queueMicrotask(() => {
          this.stdout.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { protocolVersion: "2025-11-25", capabilities: {} },
          })}\n`);
        });
        return true;
      }),
    };
    this.kill = vi.fn(() => {
      this.exitCode = 0;
      this.emit("exit", 0);
    });
  }
}

describe("MCP stdio client", () => {
  it("passes connector env and registry settings to spawned stdio servers", async () => {
    const proc = new FakeProcess();
    spawnMock.mockReturnValueOnce(proc);

    const client = new McpStdioClient({
      id: "local",
      command: "npx",
      args: ["-y", "mcp-server-example"],
      env: { API_KEY: "secret" },
      registryUrl: "https://registry.npmmirror.com",
    }, { log: console });

    await client.start();

    expect(spawnMock).toHaveBeenCalledWith(
      "npx",
      ["-y", "mcp-server-example"],
      expect.objectContaining({
        env: expect.objectContaining({
          API_KEY: "secret",
          NPM_CONFIG_REGISTRY: "https://registry.npmmirror.com",
        }),
      }),
    );

    await client.stop();
  });
});
