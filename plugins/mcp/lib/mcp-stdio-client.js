import { spawn } from "node:child_process";

export const MCP_PROTOCOL_VERSION = "2025-11-25";

export class McpStdioClient {
  constructor(server, { log = console } = {}) {
    this.server = server;
    this.log = log;
    this.process = null;
    this._nextId = 1;
    this._pending = new Map();
    this._stdoutBuffer = "";
    this._closed = false;
  }

  get running() {
    return !!this.process && !this._closed && this.process.exitCode == null;
  }

  async start() {
    if (this.running) return;
    if (!this.server?.command) throw new Error("MCP server command is required");

    this._closed = false;
    this.process = spawn(this.server.command, this.server.args || [], {
      cwd: this.server.cwd || undefined,
      env: { ...process.env, ...registryEnv(this.server), ...(this.server.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    this.process.stdout.setEncoding("utf-8");
    this.process.stdout.on("data", (chunk) => this._onStdout(chunk));
    this.process.stderr.setEncoding("utf-8");
    this.process.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.log.debug?.(`[mcp:${this.server.id}] ${text}`);
    });
    this.process.on("exit", (code, signal) => {
      this._closed = true;
      const reason = signal || (code ?? "unknown");
      const err = new Error(`MCP server exited (${reason})`);
      for (const pending of this._pending.values()) pending.reject(err);
      this._pending.clear();
    });
    this.process.on("error", (err) => {
      this._closed = true;
      for (const pending of this._pending.values()) pending.reject(err);
      this._pending.clear();
    });

    await this.initialize();
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "hana",
        title: "Hana",
        version: "0.1.0",
      },
    }, { timeout: requestTimeoutMs(this.server) });
    this.notify("notifications/initialized", {});
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {}, { timeout: requestTimeoutMs(this.server) });
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args) {
    return this.request("tools/call", {
      name,
      arguments: args || {},
    }, { timeout: requestTimeoutMs(this.server) });
  }

  request(method, params = {}, { timeout = 30_000 } = {}) {
    if (!this.running) throw new Error("MCP server is not running");
    const id = this._nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, timeout);
      this._pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this._send(payload);
    });
  }

  notify(method, params = {}) {
    if (!this.running) return;
    this._send({ jsonrpc: "2.0", method, params });
  }

  async stop() {
    if (!this.process) return;
    const proc = this.process;
    this.process = null;
    this._closed = true;
    try { proc.stdin.end(); } catch {}
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { proc.kill("SIGTERM"); } catch {}
        resolve();
      }, 2_000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  _send(payload) {
    const line = JSON.stringify(payload);
    this.process.stdin.write(line + "\n", "utf-8");
  }

  _onStdout(chunk) {
    this._stdoutBuffer += chunk;
    while (true) {
      const idx = this._stdoutBuffer.indexOf("\n");
      if (idx === -1) return;
      const line = this._stdoutBuffer.slice(0, idx).trim();
      this._stdoutBuffer = this._stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        this.log.warn?.(`[mcp:${this.server.id}] ignored non-JSON stdout: ${err.message}`);
        continue;
      }
      this._handleMessage(message);
    }
  }

  _handleMessage(message) {
    if (message?.id == null) return;
    const pending = this._pending.get(message.id);
    if (!pending) return;
    this._pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "MCP request failed"));
    } else {
      pending.resolve(message.result);
    }
  }
}

function registryEnv(server) {
  const registryUrl = typeof server?.registryUrl === "string" ? server.registryUrl.trim() : "";
  if (!registryUrl) return {};
  const command = commandName(server.command);
  if (command === "npx" || command === "bun" || command === "bunx") {
    return { NPM_CONFIG_REGISTRY: registryUrl };
  }
  if (command === "uv" || command === "uvx") {
    return {
      UV_DEFAULT_INDEX: registryUrl,
      PIP_INDEX_URL: registryUrl,
    };
  }
  return {};
}

function commandName(command) {
  const raw = typeof command === "string" ? command.trim() : "";
  const name = raw.split(/[\\/]/).pop() || raw;
  return name.replace(/\.exe$/i, "").toLowerCase();
}

function requestTimeoutMs(server) {
  const timeout = Number(server?.timeout || 0);
  return Number.isFinite(timeout) && timeout > 0 ? timeout * 1000 : 30_000;
}
