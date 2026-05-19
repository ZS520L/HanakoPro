import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import mediaRoute from "../plugins/image-gen/routes/media.js";

describe("image-gen provider discovery", () => {
  it("uses provider media capabilities instead of a hardcoded image provider catalog", async () => {
    const app = new Hono();
    mediaRoute(app, {
      dataDir: "/tmp/hana-image-gen-test",
      config: { get: () => ({}) },
      bus: {
        async request(type) {
          if (type === "provider:media-providers") {
            return {
              providers: {
                "plugin-image": {
                  providerId: "plugin-image",
                  displayName: "Plugin Image",
                  hasCredentials: true,
                  runtime: { kind: "local-cli" },
                  models: [{ id: "plugin-model", name: "Plugin Model" }],
                  availableModels: [],
                },
              },
            };
          }
          throw new Error(`unexpected bus request: ${type}`);
        },
      },
    });

    const res = await app.request("/providers");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.providers)).toEqual(["plugin-image"]);
    expect(body.providers["plugin-image"]).toMatchObject({
      displayName: "Plugin Image",
      models: [{ id: "plugin-model", name: "Plugin Model" }],
    });
  });
});
