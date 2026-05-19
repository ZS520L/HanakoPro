import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { createPluginProxyRoute, createPluginsRoute } from "../server/routes/plugins.js";

describe("plugin route proxy", () => {
  it("dispatches to registered plugin route", async () => {
    const routeRegistry = new Map();
    const pluginApp = new Hono();
    pluginApp.get("/hello", (c) => c.json({ msg: "world" }));
    routeRegistry.set("my-plugin", pluginApp);
    const app = new Hono();
    app.route("/api", createPluginProxyRoute(routeRegistry));
    const res = await app.request("/api/plugins/my-plugin/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ msg: "world" });
  });

  it("returns 404 for unknown plugin", async () => {
    const routeRegistry = new Map();
    const app = new Hono();
    app.route("/api", createPluginProxyRoute(routeRegistry));
    const res = await app.request("/api/plugins/nope/hello");
    expect(res.status).toBe(404);
  });

  it("returns 404 after plugin is removed from registry", async () => {
    const routeRegistry = new Map();
    const pluginApp = new Hono();
    pluginApp.get("/test", (c) => c.text("ok"));
    routeRegistry.set("temp", pluginApp);
    const app = new Hono();
    app.route("/api", createPluginProxyRoute(routeRegistry));
    let res = await app.request("/api/plugins/temp/test");
    expect(res.status).toBe(200);
    routeRegistry.delete("temp");
    res = await app.request("/api/plugins/temp/test");
    expect(res.status).toBe(404);
  });
});

// ── Management API tests ──

function mockEngine(overrides = {}) {
  const routeRegistry = new Map();
  const allowFullAccess = overrides.allowFullAccess ?? false;
  return {
    currentAgentId: "hanako",
    getAgent: overrides.getAgent || (() => ({ id: "hanako" })),
    syncPluginExtensions: vi.fn(),
    pluginManager: {
      listPlugins: () => overrides.plugins || [],
      routeRegistry,
      enablePlugin: overrides.enablePlugin || vi.fn(),
      disablePlugin: overrides.disablePlugin || vi.fn(),
      removePlugin: overrides.removePlugin || vi.fn(),
      installPlugin: overrides.installPlugin || vi.fn(),
      setFullAccess: overrides.setFullAccess || vi.fn(),
      getAllConfigSchemas: () => [],
      getConfigSchema: () => null,
      getConfig: overrides.getConfig || (() => null),
      setConfig: overrides.setConfig || vi.fn(),
      getDiagnostics: overrides.getDiagnostics || (() => overrides.diagnostics || []),
      getUserPluginsDir: () => "/user",
      isValidPluginDir: () => true,
      getAllowFullAccess: () => allowFullAccess,
      getRouteApp: (id) => routeRegistry.get(id) || null,
      ...overrides.pm,
    },
    fetch: overrides.fetch,
    hanakoHome: overrides.hanakoHome,
    getEventBus: overrides.getEventBus || (() => overrides.eventBus || null),
    pluginDevService: overrides.pluginDevService,
    getPluginDevToolsEnabled: overrides.getPluginDevToolsEnabled || (() => overrides.pluginDevToolsEnabled === true),
    setPluginDevToolsEnabled: overrides.setPluginDevToolsEnabled || vi.fn(),
    appVersion: overrides.appVersion || "0.190.2",
    recordPluginInstall: overrides.recordPluginInstall || vi.fn(),
    getPluginInstallRecord: overrides.getPluginInstallRecord || vi.fn(() => null),
  };
}

function createApp(engine) {
  const app = new Hono();
  app.route("/api", createPluginsRoute(engine));
  return app;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

describe("plugin management API", () => {
  describe("GET /plugins", () => {
    it("returns plugins with trust field", async () => {
      const engine = mockEngine({
        plugins: [
          { id: "a", name: "A", version: "1.0", description: "desc", status: "active", source: "community", trust: "full-access", contributions: {} },
        ],
      });
      const app = createApp(engine);
      const res = await app.request("/api/plugins");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].trust).toBe("full-access");
    });

    it("defaults trust to restricted", async () => {
      const engine = mockEngine({
        plugins: [
          { id: "b", name: "B", version: "1.0", description: "", status: "active", contributions: {} },
        ],
      });
      const app = createApp(engine);
      const res = await app.request("/api/plugins");
      const body = await res.json();
      expect(body[0].trust).toBe("restricted");
      expect(body[0].source).toBe("community");
    });
  });

  describe("DELETE /plugins/:id", () => {
    it("calls removePlugin and returns ok", async () => {
      const removeFn = vi.fn().mockResolvedValue(null);
      const engine = mockEngine({ removePlugin: removeFn });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/my-plugin", { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(removeFn).toHaveBeenCalledWith("my-plugin");
    });

    it("returns 404 when plugin not found", async () => {
      const removeFn = vi.fn().mockRejectedValue(new Error("not found"));
      const engine = mockEngine({ removePlugin: removeFn });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/nope", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /plugins/:id/enabled", () => {
    it("enables a plugin", async () => {
      const enableFn = vi.fn().mockResolvedValue();
      const engine = mockEngine({ enablePlugin: enableFn });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/p1/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(enableFn).toHaveBeenCalledWith("p1");
    });

    it("disables a plugin", async () => {
      const disableFn = vi.fn().mockResolvedValue();
      const engine = mockEngine({ disablePlugin: disableFn });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/p1/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(disableFn).toHaveBeenCalledWith("p1");
    });

    it("returns 404 when plugin not found", async () => {
      const enableFn = vi.fn().mockRejectedValue(new Error("not found"));
      const engine = mockEngine({ enablePlugin: enableFn });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/nope/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("plugin proxy route namespaces", () => {
    it("dispatches plugin settings routes without hitting plugin management enablement", async () => {
      const enableFn = vi.fn().mockResolvedValue();
      const engine = mockEngine({ enablePlugin: enableFn });
      const pluginApp = new Hono();
      pluginApp.put("/settings/enabled", async (c) => {
        const body = await c.req.json();
        return c.json({ routed: "plugin", enabled: body.enabled === true });
      });
      engine.pluginManager.routeRegistry.set("mcp", pluginApp);
      const app = createApp(engine);

      const res = await app.request("/api/plugins/mcp/settings/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ routed: "plugin", enabled: true });
      expect(enableFn).not.toHaveBeenCalled();
    });
  });

  describe("GET /plugins/settings", () => {
    it("returns allow_full_access setting", async () => {
      const engine = mockEngine({ allowFullAccess: true });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/settings");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ allow_full_access: true });
    });

    it("defaults to false", async () => {
      const engine = mockEngine({ allowFullAccess: false });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/settings");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ allow_full_access: false });
    });

    it("returns plugin dev tools as disabled by default", async () => {
      const engine = mockEngine();
      const app = createApp(engine);
      const res = await app.request("/api/plugins/settings");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ plugin_dev_tools_enabled: false });
    });
  });

  describe("GET /plugins UI contributions", () => {
    it("serializes page and widget UI host capability grants", async () => {
      const engine = mockEngine({
        pm: {
          getPages: () => [{
            pluginId: "demo",
            title: "Demo",
            icon: null,
            route: "/page",
            hostCapabilities: ["external.open"],
          }],
          getWidgets: () => [{
            pluginId: "demo",
            title: "Demo Widget",
            icon: null,
            route: "/widget",
            hostCapabilities: ["clipboard.writeText"],
          }],
        },
      });
      const app = createApp(engine);

      const pagesRes = await app.request("/api/plugins/pages");
      const widgetsRes = await app.request("/api/plugins/widgets");

      expect(await pagesRes.json()).toEqual([{
        pluginId: "demo",
        title: "Demo",
        icon: null,
        routeUrl: "/api/plugins/demo/page",
        hostCapabilities: ["external.open"],
      }]);
      expect(await widgetsRes.json()).toEqual([{
        pluginId: "demo",
        title: "Demo Widget",
        icon: null,
        routeUrl: "/api/plugins/demo/widget",
        hostCapabilities: ["clipboard.writeText"],
      }]);
    });

    it("serializes plugin-level UI host capability grants for card surfaces", async () => {
      const engine = mockEngine({
        pm: {
          getUiHostCapabilityGrants: () => [
            { pluginId: "demo", hostCapabilities: ["external.open"] },
          ],
        },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/ui-host-capabilities");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { pluginId: "demo", hostCapabilities: ["external.open"] },
      ]);
    });
  });

  describe("GET /plugins/event-bus/capabilities", () => {
    it("returns EventBus capability records", async () => {
      const engine = mockEngine({
        eventBus: {
          listCapabilities: () => [
            {
              type: "session:send",
              title: "Send session message",
              description: "Send text into a session.",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
              permission: "session.write",
              errors: ["NO_HANDLER"],
              stability: "stable",
              owner: "system",
              available: true,
            },
          ],
        },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/event-bus/capabilities");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        {
          type: "session:send",
          title: "Send session message",
          description: "Send text into a session.",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          permission: "session.write",
          errors: ["NO_HANDLER"],
          stability: "stable",
          owner: "system",
          available: true,
        },
      ]);
    });
  });

  describe("GET /plugins/diagnostics", () => {
    it("returns plugin, bus, task, and schedule diagnostics", async () => {
      const engine = mockEngine({
        diagnostics: [
          {
            id: "demo",
            name: "Demo",
            status: "loaded",
            activationState: "activated",
            hidden: false,
            routes: { pages: [], widgets: [] },
            tools: [{ name: "demo_search" }],
          },
        ],
        eventBus: {
          listCapabilities: () => [{ type: "task:list", available: true }],
        },
      });
      engine.taskRegistry = {
        listAll: () => [{ taskId: "t1", type: "render", status: "running" }],
        listSchedules: () => [{ scheduleId: "daily", type: "digest", enabled: true }],
      };
      const app = createApp(engine);

      const res = await app.request("/api/plugins/diagnostics");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        plugins: [
          {
            id: "demo",
            name: "Demo",
            status: "loaded",
            activationState: "activated",
            hidden: false,
            routes: { pages: [], widgets: [] },
            tools: [{ name: "demo_search" }],
          },
        ],
        eventBus: [{ type: "task:list", available: true }],
        tasks: [{ taskId: "t1", type: "render", status: "running" }],
        schedules: [{ scheduleId: "daily", type: "digest", enabled: true }],
      });
    });
  });

  describe("GET /plugins/marketplace", () => {
    it("returns marketplace plugins with installed status and readme endpoint", async () => {
      const plugin = {
        id: "demo",
        name: "Demo",
        publisher: "Hana",
        version: "1.0.0",
        description: "Demo plugin",
        trust: "restricted",
        permissions: [],
        contributions: ["tools"],
        distribution: { kind: "source", path: "plugins/demo", resolvedPath: "/tmp/demo" },
        readme: "# Demo",
      };
      const engine = mockEngine({
        plugins: [{ id: "demo", name: "Demo", version: "0.9.0", status: "loaded" }],
      });
      engine.pluginMarketplace = {
        load: async () => ({ source: { kind: "file", configured: true }, schemaVersion: 1, plugins: [plugin], warnings: [] }),
        getReadme: async () => "# Demo",
        getPlugin: async () => plugin,
        resolveSourceDistribution: () => "/tmp/demo",
      };
      const app = createApp(engine);

      const listRes = await app.request("/api/plugins/marketplace");
      const readmeRes = await app.request("/api/plugins/marketplace/demo/readme");

      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toMatchObject({
        plugins: [{
          id: "demo",
          installed: true,
          installedVersion: "0.9.0",
          selectedVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: true,
          installAction: "update",
          canInstall: true,
          distribution: { kind: "source", path: "plugins/demo" },
        }],
      });
      expect(await readmeRes.json()).toEqual({ pluginId: "demo", markdown: "# Demo" });
    });

    it("installs release marketplace plugins after downloading and verifying sha256", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-release-plugin-"));
      try {
        const zip = makeStoredZip({
          "demo/manifest.json": JSON.stringify({
            id: "demo",
            name: "Demo",
            version: "1.0.0",
            trust: "restricted",
          }),
        });
        const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
        const plugin = {
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "1.0.0",
          description: "Demo plugin",
          trust: "restricted",
          permissions: [],
          contributions: ["tools"],
          distribution: {
            kind: "release",
            packageUrl: "https://example.com/demo.zip",
            sha256,
          },
          readme: "# Demo",
        };
        const installPlugin = vi.fn(async (dir) => ({
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          installedManifestExists: fs.existsSync(path.join(dir, "manifest.json")),
        }));
        const engine = mockEngine({
          hanakoHome: tmp,
          fetch: vi.fn(async () => new Response(zip)),
          plugins: [],
          pm: {
            getUserPluginsDir: () => path.join(tmp, "plugins"),
            installPlugin,
          },
        });
        engine.pluginMarketplace = {
          load: async () => ({ source: { kind: "url", configured: true }, schemaVersion: 1, plugins: [plugin], warnings: [] }),
          getReadme: async () => "# Demo",
          getPlugin: async () => plugin,
          resolveSourceDistribution: () => null,
        };
        const app = createApp(engine);

        const listRes = await app.request("/api/plugins/marketplace");
        expect(await listRes.json()).toMatchObject({
          plugins: [{ id: "demo", canInstall: true }],
        });

        const installRes = await app.request("/api/plugins/marketplace/demo/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(installRes.status).toBe(200);
        expect(await installRes.json()).toMatchObject({
          id: "demo",
          installedManifestExists: true,
        });
        expect(installPlugin).toHaveBeenCalled();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("selects the newest compatible marketplace version and rejects downgrades without confirmation", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-marketplace-version-select-"));
      try {
        const zip = makeStoredZip({
          "demo/manifest.json": JSON.stringify({
            id: "demo",
            name: "Demo",
            version: "1.0.0",
            trust: "restricted",
          }),
        });
        const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
        const plugin = {
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "2.0.0",
          description: "Demo plugin",
          trust: "restricted",
          permissions: [],
          contributions: ["tools"],
          versions: [
            {
              version: "2.0.0",
              compatibility: { minAppVersion: "99.0.0" },
              distribution: {
                kind: "release",
                packageUrl: "https://example.com/demo-2.zip",
                sha256: "2".repeat(64),
              },
            },
            {
              version: "1.0.0",
              compatibility: { minAppVersion: "0.170.0" },
              distribution: {
                kind: "release",
                packageUrl: "https://example.com/demo-1.zip",
                sha256,
              },
            },
          ],
          readme: "# Demo",
        };
        const installPlugin = vi.fn(async () => ({
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          status: "loaded",
        }));
        const recordPluginInstall = vi.fn();
        const engine = mockEngine({
          appVersion: "0.190.2",
          hanakoHome: tmp,
          fetch: vi.fn(async () => new Response(zip)),
          plugins: [{ id: "demo", name: "Demo", version: "1.5.0", status: "loaded" }],
          recordPluginInstall,
          pm: {
            getUserPluginsDir: () => path.join(tmp, "plugins"),
            installPlugin,
            listPlugins: () => [{ id: "demo", name: "Demo", version: "1.5.0", status: "loaded" }],
          },
        });
        engine.pluginMarketplace = {
          load: async () => ({ source: { kind: "url", configured: true }, schemaVersion: 1, plugins: [plugin], warnings: [] }),
          getReadme: async () => "# Demo",
          getPlugin: async () => plugin,
          resolveSourceDistribution: () => null,
        };
        const app = createApp(engine);

        const listRes = await app.request("/api/plugins/marketplace");
        expect(await listRes.json()).toMatchObject({
          plugins: [{
            id: "demo",
            latestVersion: "2.0.0",
            selectedVersion: "1.0.0",
            installedVersion: "1.5.0",
            downgrade: true,
            installAction: "downgrade",
            canInstall: true,
          }],
        });

        const rejected = await app.request("/api/plugins/marketplace/demo/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(rejected.status).toBe(409);
        expect(await rejected.json()).toMatchObject({ code: "PLUGIN_VERSION_DOWNGRADE" });
        expect(installPlugin).not.toHaveBeenCalled();

        const allowed = await app.request("/api/plugins/marketplace/demo/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowDowngrade: true }),
        });

        expect(allowed.status).toBe(200);
        expect(await allowed.json()).toMatchObject({ id: "demo", version: "1.0.0" });
        expect(recordPluginInstall).toHaveBeenCalledWith(expect.objectContaining({
          pluginId: "demo",
          installedVersion: "1.0.0",
          source: "marketplace",
          packageUrl: "https://example.com/demo-1.zip",
          sha256,
        }));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("restores the previous plugin directory when replacement install fails", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-rollback-"));
      try {
        const userPluginsDir = path.join(tmp, "plugins");
        const existingDir = path.join(userPluginsDir, "demo");
        fs.mkdirSync(existingDir, { recursive: true });
        fs.writeFileSync(path.join(existingDir, "manifest.json"), JSON.stringify({
          id: "demo",
          name: "Demo",
          version: "1.0.0",
          trust: "restricted",
        }), "utf8");
        fs.writeFileSync(path.join(existingDir, "old.txt"), "old version", "utf8");
        const zip = makeStoredZip({
          "demo/manifest.json": JSON.stringify({
            id: "demo",
            name: "Demo",
            version: "2.0.0",
            trust: "restricted",
          }),
          "demo/new.txt": "new version",
        });
        const installPlugin = vi.fn()
          .mockRejectedValueOnce(new Error("load exploded"))
          .mockResolvedValueOnce({ id: "demo", name: "Demo", version: "1.0.0", status: "loaded" });
        const engine = mockEngine({
          hanakoHome: tmp,
          pm: {
            getUserPluginsDir: () => userPluginsDir,
            listPlugins: () => [{ id: "demo", name: "Demo", version: "1.0.0", status: "loaded", pluginDir: existingDir }],
            installPlugin,
            isValidPluginDir: (dir) => fs.existsSync(path.join(dir, "manifest.json")),
          },
        });
        const app = createApp(engine);
        const sourcePath = path.join(tmp, "demo.zip");
        fs.writeFileSync(sourcePath, zip);

        const res = await app.request("/api/plugins/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: sourcePath }),
        });

        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ error: "load exploded" });
        expect(fs.existsSync(path.join(existingDir, "old.txt"))).toBe(true);
        expect(fs.existsSync(path.join(existingDir, "new.txt"))).toBe(false);
        expect(installPlugin).toHaveBeenCalledTimes(2);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("rejects release marketplace plugins when sha256 does not match", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-release-plugin-bad-sha-"));
      try {
        const zip = makeStoredZip({
          "demo/manifest.json": JSON.stringify({
            id: "demo",
            name: "Demo",
            version: "1.0.0",
            trust: "restricted",
          }),
        });
        const plugin = {
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "1.0.0",
          description: "Demo plugin",
          trust: "restricted",
          permissions: [],
          contributions: ["tools"],
          distribution: {
            kind: "release",
            packageUrl: "https://example.com/demo.zip",
            sha256: "0".repeat(64),
          },
          readme: "# Demo",
        };
        const installPlugin = vi.fn();
        const engine = mockEngine({
          hanakoHome: tmp,
          fetch: vi.fn(async () => new Response(zip)),
          plugins: [],
          pm: {
            getUserPluginsDir: () => path.join(tmp, "plugins"),
            installPlugin,
          },
        });
        engine.pluginMarketplace = {
          load: async () => ({ source: { kind: "url", configured: true }, schemaVersion: 1, plugins: [plugin], warnings: [] }),
          getReadme: async () => "# Demo",
          getPlugin: async () => plugin,
          resolveSourceDistribution: () => null,
        };
        const app = createApp(engine);

        const installRes = await app.request("/api/plugins/marketplace/demo/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(installRes.status).toBe(502);
        expect(await installRes.json()).toEqual({ error: "Plugin release sha256 mismatch" });
        expect(installPlugin).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("PUT /plugins/settings", () => {
    it("calls setFullAccess and returns plugin list", async () => {
      const setFn = vi.fn().mockResolvedValue();
      const engine = mockEngine({
        setFullAccess: setFn,
        plugins: [
          { id: "x", name: "X", version: "1.0", description: "", status: "active", source: "community", trust: "restricted", contributions: {} },
        ],
      });
      const app = createApp(engine);
      const res = await app.request("/api/plugins/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_full_access: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].trust).toBe("restricted");
      expect(setFn).toHaveBeenCalledWith(true);
    });

    it("persists the Agent plugin dev tools setting", async () => {
      const setPluginDevToolsEnabled = vi.fn();
      const engine = mockEngine({ setPluginDevToolsEnabled });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plugin_dev_tools_enabled: true }),
      });

      expect(res.status).toBe(200);
      expect(setPluginDevToolsEnabled).toHaveBeenCalledWith(true);
    });
  });

  describe("plugin config routes", () => {
    it("returns redacted plugin config", async () => {
      const engine = mockEngine({
        getConfig: () => ({
          pluginId: "demo",
          schema: { properties: { apiKey: { type: "string", sensitive: true } } },
          values: { apiKey: "********" },
        }),
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/demo/config");

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        pluginId: "demo",
        values: { apiKey: "********" },
      });
    });

    it("validates plugin config writes", async () => {
      const setConfig = vi.fn(() => ({
        pluginId: "demo",
        schema: { properties: { enabled: { type: "boolean" } } },
        values: { enabled: true },
      }));
      const engine = mockEngine({ setConfig });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/demo/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { enabled: true } }),
      });

      expect(res.status).toBe(200);
      expect(setConfig).toHaveBeenCalledWith("demo", { enabled: true }, {
        scope: "global",
        agentId: undefined,
        sessionPath: undefined,
      });
    });

    it("accepts legacy bare config value bodies without silently dropping them", async () => {
      const setConfig = vi.fn(() => ({
        pluginId: "image-gen",
        schema: { properties: { defaultImageModel: { type: "object" } } },
        values: { defaultImageModel: { provider: "volcengine", id: "seedream-5" } },
      }));
      const engine = mockEngine({ setConfig });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/image-gen/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultImageModel: { provider: "volcengine", id: "seedream-5" } }),
      });

      expect(res.status).toBe(200);
      expect(setConfig).toHaveBeenCalledWith("image-gen", {
        defaultImageModel: { provider: "volcengine", id: "seedream-5" },
      }, {
        scope: "global",
        agentId: undefined,
        sessionPath: undefined,
      });
    });

    it("decodes null values as config deletes for HTTP patches", async () => {
      const setConfig = vi.fn(() => ({
        pluginId: "demo",
        schema: { properties: { defaultImageModel: { type: "object" } } },
        values: {},
      }));
      const engine = mockEngine({ setConfig });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/demo/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { defaultImageModel: null } }),
      });

      expect(res.status).toBe(200);
      expect(setConfig).toHaveBeenCalledWith("demo", { defaultImageModel: undefined }, {
        scope: "global",
        agentId: undefined,
        sessionPath: undefined,
      });
    });
  });

  describe("POST /plugins/install", () => {
    it("returns 400 when path is missing", async () => {
      const engine = mockEngine();
      const app = createApp(engine);
      const res = await app.request("/api/plugins/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("path is required");
    });

    it("returns 500 when pluginManager is null", async () => {
      const engine = { pluginManager: null };
      const app = createApp(engine);
      const res = await app.request("/api/plugins/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/some/dir" }),
      });
      expect(res.status).toBe(500);
    });

    it("registers a session-scoped plugin install source before installing", async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-install-"));
      try {
        const sourceDir = path.join(tmpDir, "plugin-src");
        const userPluginsDir = path.join(tmpDir, "plugins");
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, "manifest.json"), JSON.stringify({
          id: "plugin-src",
          name: "Plugin Source",
          version: "1.0.0",
        }), "utf-8");
        const sessionPath = "/sessions/plugin-install.jsonl";
        const registerSessionFile = vi.fn(({ sessionPath, filePath, label, origin, storageKind }) => ({
          id: "sf_plugin_source",
          sessionPath,
          filePath,
          realPath: filePath,
          displayName: label,
          filename: path.basename(filePath),
          label,
          ext: "",
          mime: "inode/directory",
          size: null,
          kind: "directory",
          origin,
          storageKind,
          createdAt: 1,
        }));
        const installPlugin = vi.fn(async () => ({
          id: "plugin-src",
          name: "Plugin Source",
          version: "1.0.0",
        }));
        const engine = mockEngine({
          pm: {
            getUserPluginsDir: () => userPluginsDir,
            installPlugin,
          },
        });
        engine.registerSessionFile = registerSessionFile;
        const app = createApp(engine);

        const res = await app.request("/api/plugins/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: sourceDir, sessionPath }),
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(registerSessionFile).toHaveBeenCalledWith({
          sessionPath,
          filePath: sourceDir,
          label: "plugin-src",
          origin: "plugin_install_source",
          storageKind: "install_source",
        });
        expect(installPlugin).toHaveBeenCalledWith(path.join(userPluginsDir, "plugin-src"));
        expect(data).toMatchObject({
          id: "plugin-src",
          sourceFile: {
            id: "sf_plugin_source",
            fileId: "sf_plugin_source",
            sessionPath,
            filePath: sourceDir,
            origin: "plugin_install_source",
            storageKind: "install_source",
          },
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("plugin dev routes", () => {
    it("installs a dev plugin through PluginDevService", async () => {
      const installFromSource = vi.fn(async () => ({
        ok: true,
        devRunId: "dev_1",
        plugin: { id: "demo", status: "loaded", source: "dev" },
      }));
      const engine = mockEngine({
        pluginDevService: { installFromSource },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/dev/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/workspace/demo", allowFullAccess: true }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ devRunId: "dev_1" });
      expect(installFromSource).toHaveBeenCalledWith({
        sourcePath: "/workspace/demo",
        allowFullAccess: true,
        pluginId: undefined,
      });
    });

    it("invokes a dev plugin tool through PluginDevService", async () => {
      const invokeTool = vi.fn(async () => ({
        pluginId: "demo",
        toolName: "demo_echo",
        result: { content: [{ type: "text", text: "ok" }] },
      }));
      const engine = mockEngine({
        pluginDevService: { invokeTool },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/dev/demo/tools/echo/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text: "hi" }, sessionPath: "/tmp/s.jsonl" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ toolName: "demo_echo" });
      expect(invokeTool).toHaveBeenCalledWith({
        pluginId: "demo",
        toolName: "echo",
        input: { text: "hi" },
        sessionPath: "/tmp/s.jsonl",
        agentId: undefined,
      });
    });

    it("enables and disables a dev plugin through PluginDevService", async () => {
      const enablePlugin = vi.fn(async () => ({
        ok: true,
        plugin: { id: "demo", status: "loaded", source: "dev" },
      }));
      const disablePlugin = vi.fn(async () => ({
        ok: true,
        plugin: { id: "demo", status: "disabled", source: "dev" },
      }));
      const engine = mockEngine({
        pluginDevService: { enablePlugin, disablePlugin },
      });
      const app = createApp(engine);

      const disableRes = await app.request("/api/plugins/dev/demo/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, devRunId: "dev_1" }),
      });
      const enableRes = await app.request("/api/plugins/dev/demo/enabled", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, devRunId: "dev_1", allowFullAccess: true }),
      });

      expect(disableRes.status).toBe(200);
      expect(await disableRes.json()).toMatchObject({ plugin: { status: "disabled" } });
      expect(enableRes.status).toBe(200);
      expect(await enableRes.json()).toMatchObject({ plugin: { status: "loaded" } });
      expect(disablePlugin).toHaveBeenCalledWith("demo", { devRunId: "dev_1" });
      expect(enablePlugin).toHaveBeenCalledWith("demo", {
        devRunId: "dev_1",
        allowFullAccess: true,
      });
    });

    it("resets and uninstalls a dev plugin through PluginDevService", async () => {
      const resetPlugin = vi.fn(async () => ({
        ok: true,
        devRunId: "dev_2",
        plugin: { id: "demo", status: "loaded", source: "dev" },
      }));
      const uninstallPlugin = vi.fn(async () => ({
        ok: true,
        pluginId: "demo",
        removedDir: "/hana/plugins-dev/demo",
      }));
      const engine = mockEngine({
        pluginDevService: { resetPlugin, uninstallPlugin },
      });
      const app = createApp(engine);

      const resetRes = await app.request("/api/plugins/dev/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devRunId: "dev_1", allowFullAccess: true }),
      });
      const uninstallRes = await app.request("/api/plugins/dev/demo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devRunId: "dev_2" }),
      });

      expect(resetRes.status).toBe(200);
      expect(await resetRes.json()).toMatchObject({ devRunId: "dev_2" });
      expect(uninstallRes.status).toBe(200);
      expect(await uninstallRes.json()).toMatchObject({ ok: true, pluginId: "demo" });
      expect(resetPlugin).toHaveBeenCalledWith("demo", {
        devRunId: "dev_1",
        allowFullAccess: true,
      });
      expect(uninstallPlugin).toHaveBeenCalledWith("demo", { devRunId: "dev_2" });
    });

    it("maps PluginDevService errors to their status code", async () => {
      const err = new Error("outside allowed roots");
      err.status = 403;
      err.code = "PLUGIN_DEV_SOURCE_OUTSIDE_ALLOWED_ROOTS";
      const engine = mockEngine({
        pluginDevService: {
          installFromSource: vi.fn(async () => { throw err; }),
        },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/dev/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/etc/demo" }),
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "outside allowed roots",
        code: "PLUGIN_DEV_SOURCE_OUTSIDE_ALLOWED_ROOTS",
      });
    });

    it("exposes element-first UI surface debug descriptors", async () => {
      const describeSurfaceDebug = vi.fn(() => ({
        strategy: "element-first",
        surface: { pluginId: "demo", kind: "page", routeUrl: "/api/plugins/demo/page" },
        elementBridge: { preferred: true, operations: ["describeElements", "clickElement"] },
        screenshot: { role: "visual confirmation and fallback" },
      }));
      const engine = mockEngine({
        pluginDevService: { describeSurfaceDebug },
      });
      const app = createApp(engine);

      const res = await app.request("/api/plugins/dev/surfaces/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: "demo", kind: "page" }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        strategy: "element-first",
        elementBridge: { preferred: true },
      });
      expect(describeSurfaceDebug).toHaveBeenCalledWith({ pluginId: "demo", kind: "page" });
    });

    it("lists and runs dev scenarios through PluginDevService", async () => {
      const getScenarios = vi.fn(() => [{ id: "smoke", title: "Smoke", steps: [] }]);
      const runScenario = vi.fn(async () => ({
        pluginId: "demo",
        scenarioId: "smoke",
        status: "passed",
        steps: [],
      }));
      const engine = mockEngine({
        pluginDevService: { getScenarios, runScenario },
      });
      const app = createApp(engine);

      const listRes = await app.request("/api/plugins/dev/demo/scenarios");
      const runRes = await app.request("/api/plugins/dev/demo/scenarios/smoke/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowDestructive: true }),
      });

      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toEqual({
        pluginId: "demo",
        scenarios: [{ id: "smoke", title: "Smoke", steps: [] }],
      });
      expect(runRes.status).toBe(200);
      expect(await runRes.json()).toMatchObject({ status: "passed" });
      expect(getScenarios).toHaveBeenCalledWith({ pluginId: "demo" });
      expect(runScenario).toHaveBeenCalledWith({
        pluginId: "demo",
        scenarioId: "smoke",
        allowDestructive: true,
      });
    });
  });
});
