export type ServerTrustState = 'local' | 'lan' | 'tunnel' | 'cloud';
export type ServerAuthState = 'anonymous' | 'paired' | 'user' | 'expired';

export interface ServerConnection {
  serverId: string;
  userId?: string;
  spaceId: string;
  label: string;
  userLabel?: string;
  spaceLabel?: string;
  serverVersion?: string;
  baseUrl: string;
  wsUrl: string;
  token: string | null;
  authState: ServerAuthState;
  trustState: ServerTrustState;
  capabilities: string[];
}

export interface ServerIdentity {
  serverId: string;
  userId?: string;
  spaceId: string;
  label: string;
  userLabel?: string;
  spaceLabel?: string;
  authState?: ServerAuthState;
  trustState?: ServerTrustState;
  capabilities?: string[];
  version?: string;
}

export interface ServerConnectionSource {
  activeServerConnection?: ServerConnection | null;
  serverPort?: string | number | null;
  serverToken?: string | null;
}

const LOCAL_CAPABILITIES = ['chat', 'resources', 'tools'];

function normalizePort(port: string | number | null | undefined): string | null {
  if (port === null || port === undefined) return null;
  const text = String(port).trim();
  if (!text) return null;

  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`invalid local server port: ${text}`);
  }
  return text;
}

function normalizeToken(token: string | null | undefined): string | null {
  if (token === null || token === undefined || token === '') return null;
  return String(token);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertRoutePath(path: string): void {
  if (!path.startsWith('/')) {
    throw new Error(`server connection path must start with "/": ${path}`);
  }
}

function appendQueryParam(url: string, key: string, value: string): string {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const sep = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return { ...headers };
}

export function createLocalServerConnection({
  serverPort,
  serverToken,
}: {
  serverPort: string | number | null | undefined;
  serverToken?: string | null;
}): ServerConnection | null {
  const port = normalizePort(serverPort);
  if (!port) return null;

  return {
    serverId: 'local',
    spaceId: 'local',
    label: 'Local Hana',
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    token: normalizeToken(serverToken),
    authState: 'paired',
    trustState: 'local',
    capabilities: [...LOCAL_CAPABILITIES],
  };
}

export function resolveServerConnection(source: ServerConnectionSource): ServerConnection | null {
  if (source.activeServerConnection) return source.activeServerConnection;
  return createLocalServerConnection({
    serverPort: source.serverPort,
    serverToken: source.serverToken,
  });
}

export function requireServerConnection(
  source: ServerConnectionSource,
  errorMessage: string,
): ServerConnection {
  const connection = resolveServerConnection(source);
  if (!connection) throw new Error(errorMessage);
  return connection;
}

export function hasServerConnection(source: ServerConnectionSource): boolean {
  return !!resolveServerConnection(source);
}

export function mergeServerIdentity(
  connection: ServerConnection,
  identity: ServerIdentity,
): ServerConnection {
  return {
    ...connection,
    serverId: identity.serverId,
    userId: identity.userId,
    spaceId: identity.spaceId,
    label: identity.label,
    userLabel: identity.userLabel,
    spaceLabel: identity.spaceLabel,
    serverVersion: identity.version,
    authState: identity.authState || connection.authState,
    trustState: identity.trustState || connection.trustState,
    capabilities: identity.capabilities ? [...identity.capabilities] : [...connection.capabilities],
  };
}

export function buildConnectionUrl(
  connection: ServerConnection,
  path: string,
  opts: { includeTokenQuery?: boolean } = {},
): string {
  assertRoutePath(path);
  const url = `${trimTrailingSlash(connection.baseUrl)}${path}`;
  if (!opts.includeTokenQuery || !connection.token) return url;
  return appendQueryParam(url, 'token', connection.token);
}

export function buildConnectionWsUrl(
  connection: ServerConnection,
  path = '/ws',
): string {
  assertRoutePath(path);
  const url = `${trimTrailingSlash(connection.wsUrl)}${path}`;
  if (!connection.token) return url;
  return appendQueryParam(url, 'token', connection.token);
}

export function appendConnectionAuth(
  connection: ServerConnection,
  headers?: HeadersInit,
): Record<string, string> {
  const next = headersToRecord(headers);
  if (connection.token) {
    next.Authorization = `Bearer ${connection.token}`;
  }
  return next;
}
