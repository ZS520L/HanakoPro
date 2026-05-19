import { Hono } from "hono";
import { loadServerIdentity } from "../../core/server-identity.js";

const LOCAL_CAPABILITIES = ["chat", "resources", "tools"];

export function createServerIdentityRoute({ hanakoHome, appVersion = "?" }) {
  const route = new Hono();

  route.get("/server/identity", (c) => {
    try {
      const identity = loadServerIdentity(hanakoHome);
      return c.json({
        serverId: identity.serverId,
        userId: identity.userId,
        spaceId: identity.spaceId,
        label: identity.label,
        userLabel: identity.userLabel,
        spaceLabel: identity.spaceLabel,
        trustState: "local",
        authState: "paired",
        capabilities: [...LOCAL_CAPABILITIES],
        version: appVersion,
      });
    } catch (err) {
      return c.json({
        error: "invalid server identity registry",
        detail: err.message,
      }, 500);
    }
  });

  return route;
}
