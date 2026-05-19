import crypto from "node:crypto";
import { MCP_PROTOCOL_VERSION } from "./mcp-stdio-client.js";

export function parseWwwAuthenticate(value) {
  const header = String(value || "");
  const params = {};
  const bearer = header.replace(/^Bearer\s+/i, "");
  const pattern = /([a-zA-Z_][a-zA-Z0-9_-]*)=(?:"([^"]*)"|([^,\s]+))/g;
  let match;
  while ((match = pattern.exec(bearer))) {
    params[match[1]] = match[2] ?? match[3] ?? "";
  }
  return params;
}

export function createPkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function createOAuthState() {
  return base64url(crypto.randomBytes(24));
}

export async function discoverMcpOAuth({ connectorUrl, fetchImpl = globalThis.fetch } = {}) {
  if (!connectorUrl) throw new Error("connectorUrl is required");
  const challenge = await fetchAuthChallenge(connectorUrl, fetchImpl);
  const challengeParams = parseWwwAuthenticate(challenge.wwwAuthenticate);
  const resourceMetadata = await fetchProtectedResourceMetadata({
    connectorUrl,
    resourceMetadataUrl: challengeParams.resource_metadata,
    fetchImpl,
  });
  const authServer = firstString(resourceMetadata.authorization_servers);
  if (!authServer) throw new Error("MCP OAuth protected resource metadata did not include authorization_servers");
  const authMetadata = await fetchAuthorizationServerMetadata(authServer, fetchImpl);
  const authorizationEndpoint = stringOrEmpty(authMetadata.authorization_endpoint);
  const tokenEndpoint = stringOrEmpty(authMetadata.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error("MCP OAuth authorization server metadata is missing authorization_endpoint or token_endpoint");
  }
  return {
    connectorUrl,
    resourceMetadataUrl: resourceMetadata.url,
    authorizationServer: authServer,
    authorizationEndpoint,
    tokenEndpoint,
    scope: stringOrEmpty(challengeParams.scope) || scopeFromResource(resourceMetadata),
    resourceMetadata,
    authorizationMetadata: authMetadata,
  };
}

export async function createMcpOAuthAuthorization({
  connector,
  redirectUri,
  state = createOAuthState(),
  codeVerifier,
  codeChallenge,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!connector?.id) throw new Error("connector.id is required");
  if (!connector?.url) throw new Error("connector.url is required");
  if (!connector?.oauthClientId) throw new Error("OAuth client ID is required");
  if (!redirectUri) throw new Error("redirectUri is required");
  const pkce = codeVerifier && codeChallenge ? { codeVerifier, codeChallenge } : createPkcePair();
  const discovery = await discoverMcpOAuth({ connectorUrl: connector.url, fetchImpl });
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", connector.oauthClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("resource", connector.url);
  if (discovery.scope) url.searchParams.set("scope", discovery.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return {
    url: url.href,
    session: {
      state,
      connectorId: connector.id,
      connectorUrl: connector.url,
      clientId: connector.oauthClientId,
      clientSecret: stringOrEmpty(connector.oauthClientSecret),
      redirectUri,
      codeVerifier: pkce.codeVerifier,
      tokenEndpoint: discovery.tokenEndpoint,
      scope: discovery.scope,
      resource: connector.url,
      createdAt: Date.now(),
    },
    discovery,
  };
}

export async function exchangeMcpOAuthCode({
  tokenEndpoint,
  code,
  redirectUri,
  clientId,
  clientSecret = "",
  codeVerifier,
  resource,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!tokenEndpoint) throw new Error("tokenEndpoint is required");
  if (!code) throw new Error("code is required");
  if (!redirectUri) throw new Error("redirectUri is required");
  if (!clientId) throw new Error("clientId is required");
  if (!codeVerifier) throw new Error("codeVerifier is required");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId);
  body.set("code_verifier", codeVerifier);
  if (clientSecret) body.set("client_secret", clientSecret);
  if (resource) body.set("resource", resource);

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || `OAuth token exchange failed with status ${response.status}`);
  }
  const accessToken = stringOrEmpty(data.access_token);
  if (!accessToken) throw new Error("OAuth token response did not include access_token");
  return {
    accessToken,
    refreshToken: stringOrEmpty(data.refresh_token),
    expiresIn: Number.isFinite(data.expires_in) ? data.expires_in : Number(data.expires_in || 0),
    scope: stringOrEmpty(data.scope),
    tokenType: stringOrEmpty(data.token_type) || "Bearer",
    tokenEndpoint,
    obtainedAt: Date.now(),
  };
}

async function fetchAuthChallenge(connectorUrl, fetchImpl) {
  const response = await fetchImpl(connectorUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "hana", title: "Hana", version: "0.1.0" },
      },
    }),
  });
  return {
    status: response.status,
    wwwAuthenticate: response.headers.get("WWW-Authenticate") || "",
  };
}

async function fetchProtectedResourceMetadata({ connectorUrl, resourceMetadataUrl, fetchImpl }) {
  const urls = resourceMetadataUrl
    ? [resourceMetadataUrl]
    : protectedResourceMetadataUrls(connectorUrl);
  for (const url of urls) {
    const response = await fetchImpl(url);
    if (!response.ok) continue;
    const metadata = await response.json();
    return { ...metadata, url };
  }
  throw new Error("Unable to discover MCP OAuth protected resource metadata");
}

async function fetchAuthorizationServerMetadata(issuer, fetchImpl) {
  for (const url of authorizationServerMetadataUrls(issuer)) {
    const response = await fetchImpl(url);
    if (!response.ok) continue;
    return response.json();
  }
  throw new Error("Unable to discover MCP OAuth authorization server metadata");
}

export function protectedResourceMetadataUrls(connectorUrl) {
  const url = new URL(connectorUrl);
  const path = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const urls = [];
  if (path) urls.push(`${url.origin}/.well-known/oauth-protected-resource/${path}`);
  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
  return urls;
}

export function authorizationServerMetadataUrls(issuer) {
  const url = new URL(issuer);
  const path = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) {
    return [
      `${url.origin}/.well-known/oauth-authorization-server`,
      `${url.origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${url.origin}/.well-known/oauth-authorization-server/${path}`,
    `${url.origin}/.well-known/openid-configuration/${path}`,
    `${url.origin}/${path}/.well-known/openid-configuration`,
  ];
}

function scopeFromResource(resourceMetadata) {
  if (Array.isArray(resourceMetadata.scopes_supported) && resourceMetadata.scopes_supported.length > 0) {
    return resourceMetadata.scopes_supported.filter((scope) => typeof scope === "string" && scope).join(" ");
  }
  return "";
}

function firstString(values) {
  return Array.isArray(values) ? values.find((value) => typeof value === "string" && value) : "";
}

function stringOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
