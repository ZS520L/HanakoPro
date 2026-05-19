import { MCP_PROTOCOL_VERSION } from "./mcp-stdio-client.js";

const STREAMABLE_ACCEPT = "application/json, text/event-stream";
const SSE_ACCEPT = "text/event-stream";
const FALLBACK_STATUSES = new Set([400, 404, 405]);

export class McpHttpError extends Error {
  constructor(message, { status = null, body = "", headers = null } = {}) {
    super(message);
    this.name = "McpHttpError";
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export function parseSseEvents(text) {
  const events = [];
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  for (const block of normalized.split(/\n\n+/)) {
    if (!block.trim()) continue;
    const event = { event: "message", data: "", id: "" };
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event.event = value || "message";
      else if (field === "id") event.id = value;
      else if (field === "data") dataLines.push(value);
    }
    event.data = dataLines.join("\n");
    events.push(event);
  }
  return events;
}

function authToken(server) {
  return stringOrEmpty(server?.authorizationToken) || stringOrEmpty(server?.oauth?.accessToken);
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function connectorHeaders(server) {
  if (!server?.headers || typeof server.headers !== "object" || Array.isArray(server.headers)) return {};
  return Object.fromEntries(
    Object.entries(server.headers).filter(([key, value]) => typeof key === "string" && typeof value === "string"),
  );
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) || response?.headers?.get?.(name.toLowerCase()) || "";
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isJsonRpcResponse(message) {
  return message && typeof message === "object" && message.jsonrpc === "2.0" && message.id != null;
}

function methodErrorMessage(status, body) {
  if (status === 401) return "MCP connector authentication failed or token expired";
  if (status === 403) return "MCP connector authorization failed or scopes are insufficient";
  if (status === 404) return "MCP connector session expired or endpoint was not found";
  return `MCP connector HTTP request failed with status ${status}${body ? `: ${body}` : ""}`;
}

function resolveEndpoint(endpoint, baseUrl) {
  return new URL(endpoint, baseUrl).href;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs) return fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const originalSignal = init?.signal;
  const abortFromOriginal = () => controller.abort();
  originalSignal?.addEventListener?.("abort", abortFromOriginal, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener?.("abort", abortFromOriginal);
  }
}

function requestTimeoutMs(server) {
  const timeout = Number(server?.timeout || 0);
  return Number.isFinite(timeout) && timeout > 0 ? timeout * 1000 : 30_000;
}

export class McpStreamableHttpClient {
  constructor(server, { fetchImpl = globalThis.fetch, log = console } = {}) {
    this.server = server;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.endpoint = server?.url || "";
    this._nextId = 1;
    this._closed = true;
    this._initialized = false;
    this.sessionId = "";
    this.protocolVersion = MCP_PROTOCOL_VERSION;
  }

  get running() {
    return !this._closed && this._initialized;
  }

  async start() {
    if (this.running) return;
    if (!this.endpoint) throw new Error("MCP connector URL is required");
    this._closed = false;
    try {
      await this.initialize();
      this._initialized = true;
    } catch (err) {
      this._closed = true;
      this._initialized = false;
      throw err;
    }
  }

  async initialize() {
    const result = await this._request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "hana",
        title: "Hana",
        version: "0.1.0",
      },
    }, { initializing: true, retryOnSessionExpired: false });
    if (typeof result?.protocolVersion === "string") {
      this.protocolVersion = result.protocolVersion;
    }
    await this._notify("notifications/initialized", {});
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args) {
    return this.request("tools/call", {
      name,
      arguments: args || {},
    });
  }

  async request(method, params = {}, opts = {}) {
    if (!this.running) throw new Error("MCP connector is not running");
    return this._request(method, params, opts);
  }

  async _request(method, params = {}, { initializing = false, retryOnSessionExpired = true } = {}) {
    const id = this._nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    try {
      return await this._postJsonRpc(payload, { initializing });
    } catch (err) {
      if (
        retryOnSessionExpired &&
        err instanceof McpHttpError &&
        err.status === 404 &&
        this.sessionId
      ) {
        this.sessionId = "";
        this._initialized = false;
        await this.initialize();
        this._initialized = true;
        return this._request(method, params, { initializing: false, retryOnSessionExpired: false });
      }
      throw err;
    }
  }

  async _notify(method, params = {}) {
    await this._postJsonRpc({ jsonrpc: "2.0", method, params }, { initializing: false });
  }

  async stop() {
    this._closed = true;
    this._initialized = false;
    if (this.sessionId) {
      const sessionId = this.sessionId;
      this.sessionId = "";
      try {
        await this.fetchImpl(this.endpoint, {
          method: "DELETE",
          headers: this._headers({ sessionId, includeJson: false }),
        });
      } catch (err) {
        this.log.debug?.(`[mcp:${this.server.id}] remote session delete failed: ${err.message}`);
      }
    }
  }

  _headers({ sessionId = this.sessionId, includeJson = true, initializing = false } = {}) {
    const headers = {
      ...connectorHeaders(this.server),
      Accept: STREAMABLE_ACCEPT,
      "MCP-Protocol-Version": this.protocolVersion || MCP_PROTOCOL_VERSION,
    };
    if (includeJson) headers["Content-Type"] = "application/json";
    if (sessionId && !initializing) headers["MCP-Session-Id"] = sessionId;
    const token = authToken(this.server);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async _postJsonRpc(payload, { initializing = false } = {}) {
    const response = await fetchWithTimeout(this.fetchImpl, this.endpoint, {
      method: "POST",
      headers: this._headers({ initializing }),
      body: JSON.stringify(payload),
    }, requestTimeoutMs(this.server));
    if (initializing) {
      const sessionId = responseHeader(response, "MCP-Session-Id");
      if (sessionId) this.sessionId = sessionId;
    }
    if (response.status === 202 && payload.id == null) return null;
    if (!response.ok) {
      const body = await responseText(response);
      throw new McpHttpError(methodErrorMessage(response.status, body), {
        status: response.status,
        body,
        headers: response.headers,
      });
    }
    if (payload.id == null) return null;

    const contentType = responseHeader(response, "Content-Type");
    const text = await responseText(response);
    if (contentType.includes("text/event-stream")) {
      for (const event of parseSseEvents(text)) {
        if (!event.data) continue;
        const message = JSON.parse(event.data);
        if (isJsonRpcResponse(message) && message.id === payload.id) return rpcResult(message);
      }
      throw new Error(`MCP response for "${payload.method}" was not found in SSE stream`);
    }
    const message = text ? JSON.parse(text) : null;
    if (!message) return null;
    return rpcResult(message);
  }
}

export class McpLegacySseClient {
  constructor(server, { fetchImpl = globalThis.fetch, log = console } = {}) {
    this.server = server;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.sseUrl = server?.url || "";
    this.messageEndpoint = "";
    this._nextId = 1;
    this._pending = new Map();
    this._queued = new Map();
    this._closed = true;
    this._buffer = "";
    this._abort = null;
    this._endpointResolve = null;
    this._endpointReject = null;
  }

  get running() {
    return !this._closed && !!this.messageEndpoint;
  }

  async start() {
    if (this.running) return;
    if (!this.sseUrl) throw new Error("MCP connector URL is required");
    this._closed = false;
    try {
      await this._connectSse();
      await this.initialize();
    } catch (err) {
      await this.stop().catch(() => {});
      throw err;
    }
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
    });
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name, args) {
    return this.request("tools/call", {
      name,
      arguments: args || {},
    });
  }

  async request(method, params = {}, { timeout = 30_000 } = {}) {
    if (!this.running) throw new Error("MCP connector is not running");
    const id = this._nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const queued = this._queued.get(id);
    if (queued) {
      this._queued.delete(id);
      return rpcResult(queued);
    }
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
      this._postMessage(payload).catch((err) => {
        this._pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async notify(method, params = {}) {
    if (!this.running) return;
    await this._postMessage({ jsonrpc: "2.0", method, params });
  }

  async stop() {
    this._closed = true;
    this.messageEndpoint = "";
    try { this._abort?.abort(); } catch {}
    this._abort = null;
    for (const pending of this._pending.values()) {
      pending.reject(new Error("MCP connector stopped"));
    }
    this._pending.clear();
  }

  async _connectSse() {
    this._abort = new AbortController();
    const endpointPromise = new Promise((resolve, reject) => {
      this._endpointResolve = resolve;
      this._endpointReject = reject;
    });
    const response = await this.fetchImpl(this.sseUrl, {
      method: "GET",
      headers: this._headers({ accept: SSE_ACCEPT, includeJson: false }),
      signal: this._abort.signal,
    });
    if (!response.ok) {
      const body = await responseText(response);
      throw new McpHttpError(methodErrorMessage(response.status, body), {
        status: response.status,
        body,
        headers: response.headers,
      });
    }
    this._readSse(response.body).catch((err) => {
      if (!this._closed) {
        this._endpointReject?.(err);
        for (const pending of this._pending.values()) pending.reject(err);
        this._pending.clear();
      }
    });
    await withTimeout(endpointPromise, requestTimeoutMs(this.server), "MCP legacy SSE endpoint event timed out");
  }

  async _readSse(body) {
    if (!body?.getReader) {
      const text = await responseText({ text: async () => "" });
      this._consumeSse(text);
      return;
    }
    const decoder = new TextDecoder();
    const reader = body.getReader();
    while (!this._closed) {
      const { value, done } = await reader.read();
      if (done) break;
      this._consumeSse(decoder.decode(value, { stream: true }));
    }
    this._consumeSse(decoder.decode());
  }

  _consumeSse(chunk) {
    this._buffer += chunk;
    let index;
    while ((index = this._buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = this._buffer.slice(0, index);
      this._buffer = this._buffer.slice(this._buffer[index] === "\r" ? index + 4 : index + 2);
      const [event] = parseSseEvents(block + "\n\n");
      if (event) this._handleSseEvent(event);
    }
  }

  _handleSseEvent(event) {
    if (event.event === "endpoint") {
      this.messageEndpoint = resolveEndpoint(event.data, this.sseUrl);
      this._endpointResolve?.(this.messageEndpoint);
      return;
    }
    if (!event.data) return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (err) {
      this.log.warn?.(`[mcp:${this.server.id}] ignored invalid SSE JSON: ${err.message}`);
      return;
    }
    if (!isJsonRpcResponse(message)) return;
    const pending = this._pending.get(message.id);
    if (!pending) {
      this._queued.set(message.id, message);
      return;
    }
    this._pending.delete(message.id);
    try {
      pending.resolve(rpcResult(message));
    } catch (err) {
      pending.reject(err);
    }
  }

  async _postMessage(payload) {
    const response = await fetchWithTimeout(this.fetchImpl, this.messageEndpoint, {
      method: "POST",
      headers: this._headers({ accept: "application/json", includeJson: true }),
      body: JSON.stringify(payload),
    }, requestTimeoutMs(this.server));
    if (!response.ok) {
      const body = await responseText(response);
      throw new McpHttpError(methodErrorMessage(response.status, body), {
        status: response.status,
        body,
        headers: response.headers,
      });
    }
  }

  _headers({ accept, includeJson }) {
    const headers = { ...connectorHeaders(this.server), Accept: accept };
    if (includeJson) headers["Content-Type"] = "application/json";
    const token = authToken(this.server);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
}

export class McpAutoHttpClient {
  constructor(server, opts = {}) {
    this.server = server;
    this.opts = opts;
    this.client = null;
  }

  get running() {
    return this.client?.running === true;
  }

  async start() {
    const streamable = new McpStreamableHttpClient(this.server, this.opts);
    try {
      await streamable.start();
      this.client = streamable;
      return;
    } catch (err) {
      await streamable.stop().catch(() => {});
      if (!(err instanceof McpHttpError) || !FALLBACK_STATUSES.has(err.status)) throw err;
    }
    const legacy = new McpLegacySseClient(this.server, this.opts);
    await legacy.start();
    this.client = legacy;
  }

  async listTools() {
    return this.client.listTools();
  }

  async callTool(name, args) {
    return this.client.callTool(name, args);
  }

  async stop() {
    await this.client?.stop?.();
    this.client = null;
  }
}

function rpcResult(message) {
  if (message?.error) {
    throw new Error(message.error.message || "MCP request failed");
  }
  return message?.result;
}

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
