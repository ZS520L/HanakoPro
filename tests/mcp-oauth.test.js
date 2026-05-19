import { describe, it, expect, vi } from "vitest";
import {
  createMcpOAuthAuthorization,
  discoverMcpOAuth,
  exchangeMcpOAuthCode,
} from "../plugins/mcp/lib/mcp-oauth.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function formBody(init) {
  return new URLSearchParams(String(init.body));
}

describe("MCP OAuth helpers", () => {
  it("discovers OAuth metadata from a WWW-Authenticate resource metadata challenge", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://mcp.example.com/mcp") {
        return new Response("auth required", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"',
          },
        });
      }
      if (String(url) === "https://mcp.example.com/.well-known/oauth-protected-resource") {
        return jsonResponse({
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["files:read", "files:write"],
        });
      }
      if (String(url) === "https://auth.example.com/.well-known/oauth-authorization-server") {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          code_challenge_methods_supported: ["S256"],
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const metadata = await discoverMcpOAuth({
      connectorUrl: "https://mcp.example.com/mcp",
      fetchImpl,
    });

    expect(metadata.resourceMetadataUrl).toBe("https://mcp.example.com/.well-known/oauth-protected-resource");
    expect(metadata.authorizationEndpoint).toBe("https://auth.example.com/authorize");
    expect(metadata.tokenEndpoint).toBe("https://auth.example.com/token");
    expect(metadata.scope).toBe("files:read");
    expect(calls[0].init.method).toBe("POST");
  });

  it("falls back to protected resource well-known URLs when the challenge omits resource metadata", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url) === "https://mcp.example.com/public/mcp") {
        return new Response("auth required", {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer scope="calendar:read"' },
        });
      }
      if (String(url) === "https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp") {
        return jsonResponse({ authorization_servers: ["https://auth.example.com/tenant"] });
      }
      if (String(url) === "https://auth.example.com/.well-known/oauth-authorization-server/tenant") {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/tenant/authorize",
          token_endpoint: "https://auth.example.com/tenant/token",
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const metadata = await discoverMcpOAuth({
      connectorUrl: "https://mcp.example.com/public/mcp",
      fetchImpl,
    });

    expect(metadata.resourceMetadataUrl).toBe("https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp");
    expect(metadata.authorizationEndpoint).toBe("https://auth.example.com/tenant/authorize");
    expect(metadata.scope).toBe("calendar:read");
    expect(calls).toContain("https://mcp.example.com/.well-known/oauth-protected-resource/public/mcp");
  });

  it("creates an authorization URL with PKCE, resource, scope, and redirect URI", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url) === "https://mcp.example.com/mcp") {
        return new Response("auth required", {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"',
          },
        });
      }
      if (String(url) === "https://mcp.example.com/.well-known/oauth-protected-resource") {
        return jsonResponse({ authorization_servers: ["https://auth.example.com"] });
      }
      if (String(url) === "https://auth.example.com/.well-known/oauth-authorization-server") {
        return jsonResponse({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    const auth = await createMcpOAuthAuthorization({
      connector: {
        id: "github",
        url: "https://mcp.example.com/mcp",
        oauthClientId: "client-id",
      },
      redirectUri: "http://127.0.0.1:3210/api/plugins/mcp/oauth/callback",
      state: "state-123",
      codeVerifier: "verifier-123",
      codeChallenge: "challenge-123",
      fetchImpl,
    });

    const url = new URL(auth.url);
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:3210/api/plugins/mcp/oauth/callback");
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com/mcp");
    expect(url.searchParams.get("scope")).toBe("files:read");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.session).toMatchObject({
      connectorId: "github",
      codeVerifier: "verifier-123",
      tokenEndpoint: "https://auth.example.com/token",
    });
  });

  it("exchanges an OAuth authorization code for connector token state", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://auth.example.com/token");
      expect(init.method).toBe("POST");
      return jsonResponse({
        access_token: "access-123",
        refresh_token: "refresh-123",
        expires_in: 3600,
        scope: "files:read",
        token_type: "Bearer",
      });
    });

    const token = await exchangeMcpOAuthCode({
      tokenEndpoint: "https://auth.example.com/token",
      code: "code-123",
      redirectUri: "http://127.0.0.1:3210/api/plugins/mcp/oauth/callback",
      clientId: "client-id",
      clientSecret: "secret-123",
      codeVerifier: "verifier-123",
      resource: "https://mcp.example.com/mcp",
      fetchImpl,
    });

    const body = formBody(fetchImpl.mock.calls[0][1]);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("secret-123");
    expect(body.get("code_verifier")).toBe("verifier-123");
    expect(body.get("resource")).toBe("https://mcp.example.com/mcp");
    expect(token).toMatchObject({
      accessToken: "access-123",
      refreshToken: "refresh-123",
      expiresIn: 3600,
      scope: "files:read",
      tokenType: "Bearer",
    });
  });
});
