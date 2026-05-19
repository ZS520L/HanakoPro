import fs from "node:fs";
import path from "node:path";
import { McpStdioClient } from "./mcp-stdio-client.js";
import {
  McpAutoHttpClient,
  McpLegacySseClient,
  McpStreamableHttpClient,
} from "./mcp-http-client.js";
import {
  createMcpOAuthAuthorization,
  exchangeMcpOAuthCode,
} from "./mcp-oauth.js";

const DEFAULT_CONFIG = {
  enabled: false,
  connectors: [],
  servers: [],
};

const TRANSPORTS = new Set(["stdio", "remote", "streamable-http", "sse"]);
const AUTH_TYPES = new Set(["none", "bearer", "oauth"]);
const MASKED_SECRET = "********";

function normalizeTool(tool) {
  if (!tool || typeof tool.name !== "string" || !tool.name) return null;
  return {
    name: tool.name,
    title: typeof tool.title === "string" ? tool.title : tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", properties: {} },
  };
}

function normalizeConnector(connector, fallbackId = "") {
  if (!connector || typeof connector !== "object") return null;
  const id = sanitizeId(connector.id || fallbackId);
  if (!id) return null;
  const env = normalizeStringRecord(connector.env);
  const headers = normalizeStringRecord(connector.headers);
  const tools = Array.isArray(connector.tools)
    ? connector.tools.map(normalizeTool).filter(Boolean)
    : [];
  const transport = normalizeTransport(connector);
  const authorizationToken = stringOrEmpty(connector.authorizationToken || connector.authorization_token);
  const oauth = normalizeOAuthState(connector.oauth);
  const authType = normalizeAuthType(connector.authType, { authorizationToken, oauth, connector });

  return {
    id,
    name: stringOrEmpty(connector.name) || id,
    description: stringOrEmpty(connector.description),
    transport,
    url: stringOrEmpty(connector.url || connector.baseUrl),
    command: stringOrEmpty(connector.command),
    args: Array.isArray(connector.args) ? connector.args.filter((arg) => typeof arg === "string") : [],
    cwd: stringOrEmpty(connector.cwd),
    env,
    headers,
    registryUrl: stringOrEmpty(connector.registryUrl),
    timeout: normalizeTimeoutSeconds(connector.timeout),
    authType,
    authorizationToken,
    oauthClientId: stringOrEmpty(connector.oauthClientId || connector.clientId),
    oauthClientSecret: stringOrEmpty(connector.oauthClientSecret || connector.clientSecret),
    oauth,
    autoStart: connector.autoStart === true || connector.isActive === true,
    tools,
  };
}

export function sanitizeId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function toMcpToolId(serverId, toolName) {
  return sanitizeId(`${serverId}_${toolName}`);
}

export function normalizeMcpConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  const rawConnectors = Array.isArray(input.connectors)
    ? input.connectors
    : (Array.isArray(input.servers) ? input.servers : []);
  const connectors = rawConnectors
    .map((connector, index) => normalizeConnector(connector, `connector_${index + 1}`))
    .filter(Boolean);
  return {
    ...DEFAULT_CONFIG,
    enabled: input.enabled === true,
    connectors,
    servers: connectors,
  };
}

export function normalizeAgentMcpConfig(agentConfig) {
  const mcp = agentConfig?.mcp && typeof agentConfig.mcp === "object" ? agentConfig.mcp : {};
  const connectors = mcp.connectors && typeof mcp.connectors === "object"
    ? mcp.connectors
    : (mcp.servers && typeof mcp.servers === "object" ? mcp.servers : {});
  return {
    ...mcp,
    connectors,
    servers: connectors,
  };
}

export function isMcpToolEnabledForAgentConfig(agentConfig, { globalEnabled, serverId, connectorId, toolName } = {}) {
  if (globalEnabled !== true) return false;
  const id = connectorId || serverId;
  const mcp = normalizeAgentMcpConfig(agentConfig);
  const connector = mcp.connectors?.[id] || mcp.servers?.[id];
  if (connector?.enabled !== true) return false;
  return connector?.tools?.[toolName] === true;
}

export function mcpToolError(text, details = {}) {
  return {
    isError: true,
    content: [{ type: "text", text }],
    details: {
      errorCode: "mcp_unavailable",
      ...details,
    },
  };
}

export function normalizeMcpToolResult(value) {
  if (value && Array.isArray(value.content)) return value;
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  return {
    content: [{ type: "text", text: JSON.stringify(value ?? null) }],
  };
}

export function createMcpToolDefinition({
  serverId,
  connectorId = serverId,
  toolName,
  description,
  inputSchema,
  getGlobalEnabled,
  getAgentConfig,
  callTool,
}) {
  const name = toMcpToolId(connectorId, toolName);
  return {
    name,
    description: description || `MCP connector tool ${connectorId}/${toolName}`,
    parameters: inputSchema || { type: "object", properties: {} },
    metadata: { kind: "mcp", connectorId, serverId: connectorId, toolName },
    isEnabledForAgentConfig: (agentConfig) => isMcpToolEnabledForAgentConfig(agentConfig, {
      globalEnabled: getGlobalEnabled(),
      connectorId,
      serverId: connectorId,
      toolName,
    }),
    execute: async (_toolCallId, params, runtimeCtx = {}) => {
      if (getGlobalEnabled() !== true) {
        return mcpToolError("MCP is disabled globally. Enable Connectors in Settings before calling this tool.", {
          connectorId,
          serverId: connectorId,
          toolName,
        });
      }
      const agentConfig = await getAgentConfig(runtimeCtx.agentId);
      if (!isMcpToolEnabledForAgentConfig(agentConfig, {
        globalEnabled: true,
        connectorId,
        serverId: connectorId,
        toolName,
      })) {
        return mcpToolError(`MCP connector tool "${connectorId}/${toolName}" is not enabled for this agent.`, {
          connectorId,
          serverId: connectorId,
          toolName,
          agentId: runtimeCtx.agentId || null,
        });
      }
      try {
        return normalizeMcpToolResult(await callTool(connectorId, toolName, params || {}));
      } catch (err) {
        return mcpToolError(`MCP connector tool "${connectorId}/${toolName}" failed: ${err.message}`, {
          connectorId,
          serverId: connectorId,
          toolName,
        });
      }
    },
  };
}

export class McpRuntime {
  constructor(ctx, { Client = null, clientFactory = null, fetchImpl = globalThis.fetch } = {}) {
    this.ctx = ctx;
    this.Client = Client;
    this.fetchImpl = fetchImpl;
    this.clientFactory = clientFactory || ((connector, opts) => (
      this.Client ? new this.Client(connector, opts) : createDefaultClient(connector, opts)
    ));
    this.clients = new Map();
    this.toolDisposers = [];
    this.oauthSessions = new Map();
  }

  async load() {
    fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    this.registerCachedTools();
    const config = this.getConfig();
    if (config.enabled) {
      for (const connector of config.connectors.filter((s) => s.autoStart)) {
        this.startConnector(connector.id).catch((err) => {
          this.ctx.log.warn(`auto-start failed for ${connector.id}: ${err.message}`);
        });
      }
    }
  }

  async dispose() {
    for (const dispose of this.toolDisposers.splice(0)) {
      try { dispose(); } catch {}
    }
    for (const client of this.clients.values()) {
      await client.stop().catch(() => {});
    }
    this.clients.clear();
    this.oauthSessions.clear();
  }

  getConfig() {
    return normalizeMcpConfig(this.ctx.config.get("mcp"));
  }

  saveConfig(config) {
    const normalized = normalizeMcpConfig(config);
    this.ctx.config.set("mcp", {
      enabled: normalized.enabled,
      connectors: normalized.connectors,
    });
    return normalized;
  }

  getState(agentConfig = null) {
    const config = this.getConfig();
    const connectors = config.connectors.map((connector) => publicConnector({
      connector,
      status: this.clients.get(connector.id)?.running ? "running" : "stopped",
    }));
    return {
      enabled: config.enabled,
      connectors,
      servers: connectors,
      agentConfig: normalizeAgentMcpConfig(agentConfig),
    };
  }

  async setEnabled(enabled) {
    const config = this.getConfig();
    config.enabled = enabled === true;
    const saved = this.saveConfig(config);
    if (!saved.enabled) {
      for (const connector of saved.connectors) {
        await this.stopConnector(connector.id);
      }
    }
    this.registerCachedTools();
    return saved;
  }

  addConnector(input) {
    const config = this.getConfig();
    const id = uniqueConnectorId(config.connectors, input?.id || input?.name || input?.url || input?.command || "connector");
    const connector = normalizeConnector({ ...input, id }, id);
    validateConnector(connector);
    config.connectors.push(connector);
    const saved = this.saveConfig(config);
    this.registerCachedTools();
    return saved.connectors.find((s) => s.id === id);
  }

  addServer(input) {
    return this.addConnector(input);
  }

  async updateConnector(id, patch) {
    const config = this.getConfig();
    const index = config.connectors.findIndex((s) => s.id === id);
    if (index === -1) throw new Error(`MCP connector "${id}" not found`);
    const existing = config.connectors[index];
    const unmaskedPatch = unmaskConnectorPatch(existing, patch || {});
    const next = normalizeConnector({ ...existing, ...unmaskedPatch, id: existing.id, tools: patch?.tools || existing.tools }, existing.id);
    validateConnector(next);
    const changedClient = connectorClientFingerprint(next) !== connectorClientFingerprint(existing);
    config.connectors[index] = next;
    const saved = this.saveConfig(config);
    if (changedClient) await this.stopConnector(id);
    this.registerCachedTools();
    return saved.connectors[index];
  }

  async updateServer(id, patch) {
    return this.updateConnector(id, patch);
  }

  async removeConnector(id) {
    await this.stopConnector(id);
    const config = this.getConfig();
    config.connectors = config.connectors.filter((s) => s.id !== id);
    const saved = this.saveConfig(config);
    this.registerCachedTools();
    return saved;
  }

  async removeServer(id) {
    return this.removeConnector(id);
  }

  async startConnector(id) {
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    const connector = config.connectors.find((s) => s.id === id);
    if (!connector) throw new Error(`MCP connector "${id}" not found`);
    const existing = this.clients.get(id);
    if (existing?.running) return connector;

    const client = this.clientFactory(connector, { log: this.ctx.log, fetchImpl: this.fetchImpl });
    this.clients.set(id, client);
    try {
      await client.start();
      await this.refreshTools(id);
      return this.getConfig().connectors.find((s) => s.id === id);
    } catch (err) {
      this.clients.delete(id);
      await client.stop().catch(() => {});
      throw err;
    }
  }

  async startServer(id) {
    return this.startConnector(id);
  }

  async stopConnector(id) {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    await client.stop();
  }

  async stopServer(id) {
    return this.stopConnector(id);
  }

  async refreshTools(id) {
    const client = this.clients.get(id);
    if (!client?.running) throw new Error(`MCP connector "${id}" is not running`);
    const tools = await client.listTools();
    const config = this.getConfig();
    const connector = config.connectors.find((s) => s.id === id);
    if (!connector) throw new Error(`MCP connector "${id}" not found`);
    connector.tools = tools.map(normalizeTool).filter(Boolean);
    this.saveConfig(config);
    this.registerCachedTools();
    return connector.tools;
  }

  async callTool(connectorId, toolName, args) {
    const config = this.getConfig();
    if (!config.enabled) throw new Error("MCP connectors are disabled globally");
    const client = this.clients.get(connectorId);
    if (!client?.running) throw new Error(`MCP connector "${connectorId}" is not running`);
    return client.callTool(toolName, args);
  }

  registerCachedTools() {
    for (const dispose of this.toolDisposers.splice(0)) {
      try { dispose(); } catch {}
    }
    const config = this.getConfig();
    for (const connector of config.connectors) {
      for (const tool of connector.tools || []) {
        const definition = createMcpToolDefinition({
          connectorId: connector.id,
          serverId: connector.id,
          toolName: tool.name,
          description: tool.description || `${connector.name}: ${tool.title || tool.name}`,
          inputSchema: tool.inputSchema,
          getGlobalEnabled: () => this.getConfig().enabled,
          getAgentConfig: (agentId) => this.getAgentConfig(agentId),
          callTool: (connectorId, toolName, args) => this.callTool(connectorId, toolName, args),
        });
        this.toolDisposers.push(this.ctx.registerTool(definition));
      }
    }
  }

  async getAgentConfig(agentId) {
    if (!agentId || !this.ctx.bus?.request) return {};
    const result = await this.ctx.bus.request("agent:config", { agentId });
    if (result?.error) throw new Error(result.error);
    return result?.config || {};
  }

  async updateAgentMcpConnector(agentId, connectorId, patch) {
    if (!agentId) throw new Error("agentId is required");
    const current = await this.getAgentConfig(agentId);
    const existingMcp = current.mcp && typeof current.mcp === "object" ? current.mcp : {};
    const normalizedMcp = normalizeAgentMcpConfig(current);
    const connectors = normalizedMcp.connectors && typeof normalizedMcp.connectors === "object"
      ? { ...normalizedMcp.connectors }
      : {};
    const existingConnector = connectors[connectorId] && typeof connectors[connectorId] === "object"
      ? connectors[connectorId]
      : {};
    connectors[connectorId] = {
      ...existingConnector,
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(patch.tools && typeof patch.tools === "object" ? { tools: { ...(existingConnector.tools || {}), ...patch.tools } } : {}),
    };
    const partial = {
      mcp: {
        ...existingMcp,
        connectors,
        servers: null,
      },
    };
    const result = await this.ctx.bus.request("agent:update-config", { agentId, partial });
    if (result?.error) throw new Error(result.error);
    return result?.config || partial;
  }

  async updateAgentMcpServer(agentId, serverId, patch) {
    return this.updateAgentMcpConnector(agentId, serverId, patch);
  }

  async startOAuth(connectorId, redirectUri) {
    const connector = this.getConfig().connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    const { url, session } = await createMcpOAuthAuthorization({
      connector,
      redirectUri,
      fetchImpl: this.fetchImpl,
    });
    this.oauthSessions.set(session.state, { status: "pending", ...session });
    return { sessionId: session.state, url };
  }

  async completeOAuth({ state, code, error }) {
    const session = this.oauthSessions.get(state);
    if (!session) throw new Error("OAuth session not found");
    if (error) {
      session.status = "error";
      session.error = error;
      return session;
    }
    try {
      const token = await exchangeMcpOAuthCode({
        tokenEndpoint: session.tokenEndpoint,
        code,
        redirectUri: session.redirectUri,
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        codeVerifier: session.codeVerifier,
        resource: session.resource,
        fetchImpl: this.fetchImpl,
      });
      await this.saveConnectorOAuth(session.connectorId, token);
      session.status = "done";
      session.result = { connectorId: session.connectorId };
      return session;
    } catch (err) {
      session.status = "error";
      session.error = err.message;
      throw err;
    }
  }

  getOAuthStatus(sessionId) {
    const session = this.oauthSessions.get(sessionId);
    if (!session) return { status: "missing" };
    if (session.status === "done") return { status: "done", result: session.result || null };
    if (session.status === "error") return { status: "error", error: session.error || "OAuth failed" };
    return { status: "pending" };
  }

  async saveConnectorOAuth(connectorId, token) {
    const config = this.getConfig();
    const connector = config.connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    connector.authType = "oauth";
    connector.authorizationToken = "";
    connector.oauth = {
      ...token,
      expiresAt: token.expiresIn ? token.obtainedAt + token.expiresIn * 1000 : 0,
    };
    const saved = this.saveConfig(config);
    await this.stopConnector(connectorId);
    return saved.connectors.find((item) => item.id === connectorId);
  }

  async logoutOAuth(connectorId) {
    const config = this.getConfig();
    const connector = config.connectors.find((item) => item.id === connectorId);
    if (!connector) throw new Error(`MCP connector "${connectorId}" not found`);
    connector.oauth = {};
    connector.authorizationToken = "";
    const saved = this.saveConfig(config);
    await this.stopConnector(connectorId);
    return saved.connectors.find((item) => item.id === connectorId);
  }
}

function createDefaultClient(connector, opts) {
  if (connector.transport === "stdio") return new McpStdioClient(connector, opts);
  if (connector.transport === "streamable-http") return new McpStreamableHttpClient(connector, opts);
  if (connector.transport === "sse") return new McpLegacySseClient(connector, opts);
  return new McpAutoHttpClient(connector, opts);
}

function normalizeTransport(connector) {
  const raw = stringOrEmpty(connector.transport || connector.type);
  if (raw === "http") return "remote";
  if (raw === "streamableHttp" || raw === "streamable-http") return "streamable-http";
  if (TRANSPORTS.has(raw)) return raw;
  if (stringOrEmpty(connector.url || connector.baseUrl)) return "remote";
  return "stdio";
}

function normalizeAuthType(value, { authorizationToken, oauth, connector }) {
  const raw = stringOrEmpty(value);
  if (AUTH_TYPES.has(raw)) return raw;
  if (authorizationToken) return "bearer";
  if (oauth.accessToken || connector.oauthClientId || connector.clientId) return "oauth";
  return "none";
}

function normalizeOAuthState(value) {
  if (!value || typeof value !== "object") return {};
  return {
    accessToken: stringOrEmpty(value.accessToken),
    refreshToken: stringOrEmpty(value.refreshToken),
    tokenType: stringOrEmpty(value.tokenType) || (value.accessToken ? "Bearer" : ""),
    tokenEndpoint: stringOrEmpty(value.tokenEndpoint),
    scope: stringOrEmpty(value.scope),
    expiresIn: Number(value.expiresIn || 0) || 0,
    expiresAt: Number(value.expiresAt || 0) || 0,
    obtainedAt: Number(value.obtainedAt || 0) || 0,
  };
}

function validateConnector(connector) {
  if (!connector) throw new Error("connector is required");
  if (connector.transport === "stdio") {
    if (!connector.command) throw new Error("command is required");
    return;
  }
  if (!connector.url) throw new Error("url is required");
  const url = new URL(connector.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must use http or https");
  }
}

function uniqueConnectorId(connectors, raw) {
  const base = sanitizeId(raw) || "connector";
  const taken = new Set(connectors.map((s) => s.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function connectorClientFingerprint(connector) {
  return JSON.stringify({
    transport: connector.transport,
    url: connector.url,
    command: connector.command,
    args: connector.args,
    cwd: connector.cwd,
    env: connector.env,
    headers: connector.headers,
    registryUrl: connector.registryUrl,
    timeout: connector.timeout,
    authType: connector.authType,
    authorizationToken: connector.authorizationToken,
    oauthAccessToken: connector.oauth?.accessToken || "",
  });
}

function publicConnector({ connector, status }) {
  return {
    ...connector,
    status,
    env: redactRecord(connector.env),
    headers: redactRecord(connector.headers),
    authorizationToken: connector.authorizationToken ? "********" : "",
    oauthClientSecret: connector.oauthClientSecret ? "********" : "",
    oauth: {
      connected: !!connector.oauth?.accessToken,
      scope: connector.oauth?.scope || "",
      expiresAt: connector.oauth?.expiresAt || 0,
    },
    authStatus: connectorAuthStatus(connector),
  };
}

function connectorAuthStatus(connector) {
  if (connector.authType === "none") return "none";
  if (connector.authType === "bearer") return connector.authorizationToken ? "token" : "missing";
  if (connector.authType === "oauth") return connector.oauth?.accessToken ? "connected" : "disconnected";
  return "none";
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, val]) => typeof key === "string" && typeof val === "string"),
  );
}

function normalizeTimeoutSeconds(value) {
  if (value === "" || value == null) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function redactRecord(value) {
  const record = normalizeStringRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, val]) => [key, val ? MASKED_SECRET : ""]),
  );
}

function unmaskConnectorPatch(existing, patch) {
  const next = { ...patch };
  if (patch.authorizationToken === MASKED_SECRET) {
    next.authorizationToken = existing.authorizationToken || "";
  }
  if (patch.oauthClientSecret === MASKED_SECRET) {
    next.oauthClientSecret = existing.oauthClientSecret || "";
  }
  if (patch.env && typeof patch.env === "object" && !Array.isArray(patch.env)) {
    next.env = unmaskRecord(existing.env, patch.env);
  }
  if (patch.headers && typeof patch.headers === "object" && !Array.isArray(patch.headers)) {
    next.headers = unmaskRecord(existing.headers, patch.headers);
  }
  return next;
}

function unmaskRecord(existing, patch) {
  const existingRecord = normalizeStringRecord(existing);
  const patchRecord = normalizeStringRecord(patch);
  return Object.fromEntries(
    Object.entries(patchRecord).map(([key, val]) => [
      key,
      val === MASKED_SECRET && Object.hasOwn(existingRecord, key) ? existingRecord[key] : val,
    ]),
  );
}

export function configPathForDataDir(dataDir) {
  return path.join(dataDir, "config.json");
}
