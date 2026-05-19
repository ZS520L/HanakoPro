import { describe, expect, it } from 'vitest';

import {
  appendConnectionAuth,
  buildConnectionUrl,
  buildConnectionWsUrl,
  createLocalServerConnection,
  hasServerConnection,
  mergeServerIdentity,
  resolveServerConnection,
} from '../../services/server-connection';

describe('server connection helpers', () => {
  it('creates the local default ServerConnection from port and token', () => {
    expect(createLocalServerConnection({
      serverPort: 3210,
      serverToken: 'test-token-123',
    })).toEqual({
      serverId: 'local',
      spaceId: 'local',
      label: 'Local Hana',
      baseUrl: 'http://127.0.0.1:3210',
      wsUrl: 'ws://127.0.0.1:3210',
      token: 'test-token-123',
      authState: 'paired',
      trustState: 'local',
      capabilities: ['chat', 'resources', 'tools'],
    });
  });

  it('returns null when local server port is not ready', () => {
    expect(createLocalServerConnection({
      serverPort: null,
      serverToken: 'test-token-123',
    })).toBeNull();
  });

  it('reports readiness from active connection while preserving legacy compatibility', () => {
    const active = createLocalServerConnection({
      serverPort: 4242,
      serverToken: 'active-token',
    });

    expect(hasServerConnection({ activeServerConnection: active })).toBe(true);
    expect(hasServerConnection({ serverPort: 3210, serverToken: 'legacy-token' })).toBe(true);
    expect(hasServerConnection({ serverPort: null, serverToken: 'legacy-token' })).toBe(false);
  });

  it('prefers the active connection over legacy port and token fields', () => {
    const active = createLocalServerConnection({
      serverPort: 4242,
      serverToken: 'active-token',
    });

    expect(resolveServerConnection({
      activeServerConnection: active,
      serverPort: 3210,
      serverToken: 'legacy-token',
    })).toBe(active);
  });

  it('builds browser-loadable URLs with query token while preserving existing query params', () => {
    const connection = createLocalServerConnection({
      serverPort: '3210',
      serverToken: 'test-token-123',
    });
    expect(connection).not.toBeNull();

    expect(buildConnectionUrl(connection!, '/api/agents/hana/avatar', { includeTokenQuery: true }))
      .toBe('http://127.0.0.1:3210/api/agents/hana/avatar?token=test-token-123');
    expect(buildConnectionUrl(connection!, '/api/sessions?limit=10', { includeTokenQuery: true }))
      .toBe('http://127.0.0.1:3210/api/sessions?limit=10&token=test-token-123');
  });

  it('builds fetch URLs without leaking token into the query string', () => {
    const connection = createLocalServerConnection({
      serverPort: '3210',
      serverToken: 'test-token-123',
    });
    expect(connection).not.toBeNull();

    expect(buildConnectionUrl(connection!, '/api/health')).toBe('http://127.0.0.1:3210/api/health');
  });

  it('injects Authorization while preserving caller headers', () => {
    const connection = createLocalServerConnection({
      serverPort: '3210',
      serverToken: 'test-token-123',
    });
    expect(connection).not.toBeNull();

    expect(appendConnectionAuth(connection!, { 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token-123',
    });
  });

  it('builds WebSocket URLs with query token for browser WebSocket auth', () => {
    const connection = createLocalServerConnection({
      serverPort: '3210',
      serverToken: 'test-token-123',
    });
    expect(connection).not.toBeNull();

    expect(buildConnectionWsUrl(connection!, '/ws')).toBe('ws://127.0.0.1:3210/ws?token=test-token-123');
  });

  it('merges stable server identity without changing transport details', () => {
    const connection = createLocalServerConnection({
      serverPort: '3210',
      serverToken: 'test-token-123',
    });
    expect(connection).not.toBeNull();

    expect(mergeServerIdentity(connection!, {
      serverId: 'server_stable',
      userId: 'user_stable',
      spaceId: 'space_stable',
      label: 'Stable Server',
      userLabel: 'Stable User',
      spaceLabel: 'Stable Space',
      authState: 'paired',
      trustState: 'local',
      capabilities: ['chat', 'resources', 'tools', 'identity'],
      version: '1.2.3',
    })).toEqual({
      serverId: 'server_stable',
      userId: 'user_stable',
      spaceId: 'space_stable',
      label: 'Stable Server',
      userLabel: 'Stable User',
      spaceLabel: 'Stable Space',
      serverVersion: '1.2.3',
      baseUrl: 'http://127.0.0.1:3210',
      wsUrl: 'ws://127.0.0.1:3210',
      token: 'test-token-123',
      authState: 'paired',
      trustState: 'local',
      capabilities: ['chat', 'resources', 'tools', 'identity'],
    });
  });
});
