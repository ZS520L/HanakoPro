export type McpTransport = 'stdio' | 'remote' | 'streamable-http' | 'sse';
export type McpAuthType = 'none' | 'bearer' | 'oauth';
export type McpConnectorStatus = 'running' | 'stopped';

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
}

export interface McpOAuthState {
  connected?: boolean;
  scope?: string;
  expiresAt?: number;
}

export interface McpConnector {
  id: string;
  name: string;
  description?: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  registryUrl?: string;
  timeout?: number;
  autoStart?: boolean;
  status: McpConnectorStatus;
  tools: McpTool[];
  authType?: McpAuthType;
  authStatus?: string;
  authorizationToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauth?: McpOAuthState;
}

export interface McpAgentConnectorConfig {
  enabled?: boolean;
  tools?: Record<string, boolean>;
}

export interface McpState {
  enabled: boolean;
  connectors: McpConnector[];
  servers?: McpConnector[];
  agentConfig: {
    connectors?: Record<string, McpAgentConnectorConfig>;
    servers?: Record<string, McpAgentConnectorConfig>;
  };
}

export interface McpConnectorInput {
  name?: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  description?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  registryUrl?: string;
  timeout?: number;
  autoStart?: boolean;
  authType?: McpAuthType;
  authorizationToken?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}
