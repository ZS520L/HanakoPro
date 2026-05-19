import type { McpConnectorInput, McpTransport } from './types';

type McpJsonServer = Record<string, unknown>;

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function parseKeyValueLines(value: string, kind: 'env' | 'headers'): Record<string, string> {
  const result: Record<string, string> = {};
  const keyPattern = kind === 'env' ? ENV_KEY : HEADER_KEY;
  for (const [index, rawLine] of value.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) {
      throw new Error(`${kind} line ${index + 1} must use KEY=value`);
    }
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (!keyPattern.test(key)) {
      throw new Error(`${kind} line ${index + 1} has an invalid key`);
    }
    result[key] = unquoteValue(raw);
  }
  return result;
}

export function serializeKeyValueLines(value?: Record<string, string>): string {
  if (!value) return '';
  return Object.entries(value)
    .filter(([key, val]) => typeof key === 'string' && typeof val === 'string')
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');
}

export function connectorsFromMcpJson(value: string): McpConnectorInput[] {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP JSON must be an object');
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('MCP JSON must contain mcpServers');
  }
  return Object.entries(servers as Record<string, unknown>).map(([id, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`MCP server "${id}" must be an object`);
    }
    return connectorFromJsonServer(id, raw as McpJsonServer);
  });
}

function connectorFromJsonServer(id: string, raw: McpJsonServer): McpConnectorInput {
  const url = stringValue(raw.baseUrl) || stringValue(raw.url);
  const command = stringValue(raw.command);
  const transport = jsonTransport(raw, url);
  const connector: McpConnectorInput = {
    name: stringValue(raw.name) || id,
    transport,
    ...(stringValue(raw.description) ? { description: stringValue(raw.description) } : {}),
    ...(url ? { url } : {}),
    ...(command ? { command } : {}),
    ...(arrayOfStrings(raw.args).length ? { args: arrayOfStrings(raw.args) } : {}),
    ...(stringValue(raw.cwd) ? { cwd: stringValue(raw.cwd) } : {}),
    ...(stringRecord(raw.env) ? { env: stringRecord(raw.env) } : {}),
    ...(stringRecord(raw.headers) ? { headers: stringRecord(raw.headers) } : {}),
    ...(stringValue(raw.registryUrl) ? { registryUrl: stringValue(raw.registryUrl) } : {}),
    ...(positiveNumber(raw.timeout) ? { timeout: positiveNumber(raw.timeout) } : {}),
    ...(raw.autoStart === true || raw.isActive === true ? { autoStart: true } : {}),
  };
  if (transport === 'stdio' && !connector.command) {
    throw new Error(`MCP server "${id}" is missing command`);
  }
  if (transport !== 'stdio' && !connector.url) {
    throw new Error(`MCP server "${id}" is missing url`);
  }
  return connector;
}

function jsonTransport(raw: McpJsonServer, url: string): McpTransport {
  const type = stringValue(raw.transport) || stringValue(raw.type);
  if (type === 'streamableHttp' || type === 'streamable-http') return 'streamable-http';
  if (type === 'sse') return 'sse';
  if (type === 'remote' || type === 'http') return 'remote';
  if (type === 'stdio') return 'stdio';
  if (url) return url.endsWith('/mcp') ? 'streamable-http' : 'sse';
  return 'stdio';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[0] === 'string' && typeof entry[1] === 'string'
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function positiveNumber(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function unquoteValue(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === '\'' || quote === '`') && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}
