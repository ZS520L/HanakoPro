import { describe, expect, it } from 'vitest';
import { connectorsFromMcpJson, parseKeyValueLines, serializeKeyValueLines } from './mcp-config';

describe('mcp connector config helpers', () => {
  it('parses dotenv-style key value lines', () => {
    expect(parseKeyValueLines('API_KEY=secret\n# comment\nBASE_URL=https://example.com?a=b\nEMPTY=', 'env')).toEqual({
      API_KEY: 'secret',
      BASE_URL: 'https://example.com?a=b',
      EMPTY: '',
    });
  });

  it('serializes key value records for editing', () => {
    expect(serializeKeyValueLines({
      API_KEY: '********',
      BASE_URL: 'https://example.com',
    })).toBe('API_KEY=********\nBASE_URL=https://example.com');
  });

  it('converts Cherry and Claude style MCP JSON into Hana connector inputs', () => {
    const connectors = connectorsFromMcpJson(JSON.stringify({
      mcpServers: {
        remote: {
          type: 'streamableHttp',
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
          timeout: 45,
          isActive: true,
        },
        local: {
          command: 'npx',
          args: ['-y', 'mcp-server-example'],
          env: { API_KEY: 'secret' },
          registryUrl: 'https://registry.npmmirror.com',
        },
      },
    }));

    expect(connectors).toEqual([
      {
        name: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer secret' },
        timeout: 45,
        autoStart: true,
      },
      {
        name: 'local',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-server-example'],
        env: { API_KEY: 'secret' },
        registryUrl: 'https://registry.npmmirror.com',
      },
    ]);
  });
});
