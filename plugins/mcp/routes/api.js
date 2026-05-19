export default function registerMcpRoutes(app, ctx) {
  const runtime = () => ctx._mcpRuntime;

  async function agentConfig(agentId) {
    if (!agentId) return {};
    const result = await ctx.bus.request("agent:config", { agentId });
    if (result?.error) throw new Error(result.error);
    return result?.config || {};
  }

  async function currentState(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    const agentId = c.req.query("agentId") || c.get("agentId") || null;
    const config = await agentConfig(agentId);
    return c.json(rt.getState(config));
  }

  function redirectUriForRequest(c) {
    const url = new URL(c.req.url);
    return new URL("/api/plugins/mcp/oauth/callback", url.origin).href;
  }

  function htmlPage(title, body) {
    return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.5;color:#333;background:#faf8f2"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>`;
  }

  app.get("/state", currentState);

  async function setGlobalEnabled(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    const { enabled } = await c.req.json();
    try {
      await rt.setEnabled(enabled === true);
      return currentState(c);
    } catch (err) {
      ctx.log.error(`set global enabled failed: ${err.message}`);
      return c.json({ error: err.message }, 400);
    }
  }

  app.put("/settings/enabled", setGlobalEnabled);
  app.put("/enabled", setGlobalEnabled);

  async function addConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = rt.addConnector(await c.req.json());
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, server: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function updateConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = await rt.updateConnector(c.req.param("id"), await c.req.json());
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, server: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function removeConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      await rt.removeConnector(c.req.param("id"));
      return c.json(rt.getState());
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function connectorAction(c, action) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const id = c.req.param("id");
      if (action === "start") await rt.startConnector(id);
      else if (action === "stop") await rt.stopConnector(id);
      else if (action === "refresh-tools") {
        const tools = await rt.refreshTools(id);
        return c.json({ tools, state: rt.getState() });
      }
      return c.json(rt.getState());
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function updateAgentConnector(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const config = await rt.updateAgentMcpConnector(
        c.req.param("agentId"),
        c.req.param("id"),
        await c.req.json(),
      );
      return c.json({ config });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  app.post("/connectors", addConnector);
  app.post("/servers", addConnector);
  app.put("/connectors/:id", updateConnector);
  app.put("/servers/:id", updateConnector);
  app.delete("/connectors/:id", removeConnector);
  app.delete("/servers/:id", removeConnector);

  app.post("/connectors/:id/start", (c) => connectorAction(c, "start"));
  app.post("/servers/:id/start", (c) => connectorAction(c, "start"));
  app.post("/connectors/:id/stop", (c) => connectorAction(c, "stop"));
  app.post("/servers/:id/stop", (c) => connectorAction(c, "stop"));
  app.post("/connectors/:id/refresh-tools", (c) => connectorAction(c, "refresh-tools"));
  app.post("/servers/:id/refresh-tools", (c) => connectorAction(c, "refresh-tools"));

  app.put("/agents/:agentId/connectors/:id", updateAgentConnector);
  app.put("/agents/:agentId/servers/:id", updateAgentConnector);

  async function startOAuth(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      return c.json(await rt.startOAuth(c.req.param("id"), redirectUriForRequest(c)));
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  async function logoutOAuth(c) {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    try {
      const connector = await rt.logoutOAuth(c.req.param("id"));
      const state = rt.getState();
      const publicConnector = state.connectors.find((item) => item.id === connector.id) || connector;
      return c.json({ connector: publicConnector, state });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  }

  app.post("/connectors/:id/oauth/start", startOAuth);
  app.post("/servers/:id/oauth/start", startOAuth);
  app.post("/connectors/:id/oauth/logout", logoutOAuth);
  app.post("/servers/:id/oauth/logout", logoutOAuth);

  app.get("/oauth/callback", async (c) => {
    const rt = runtime();
    if (!rt) return c.html(htmlPage("MCP Connector OAuth", "MCP runtime is not initialized."), 503);
    const url = new URL(c.req.url);
    try {
      await rt.completeOAuth({
        state: url.searchParams.get("state") || "",
        code: url.searchParams.get("code") || "",
        error: url.searchParams.get("error") || "",
      });
      return c.html(htmlPage("Connector connected", "You can close this window and return to Hana."));
    } catch (err) {
      return c.html(htmlPage("Connector OAuth failed", err.message), 400);
    }
  });

  app.get("/oauth/poll/:sessionId", (c) => {
    const rt = runtime();
    if (!rt) return c.json({ error: "not initialized" }, 503);
    return c.json(rt.getOAuthStatus(c.req.param("sessionId")));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
