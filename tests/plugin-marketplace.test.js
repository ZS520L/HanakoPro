import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICIAL_PLUGIN_MARKETPLACE_URL,
  PluginMarketplace,
  createDefaultPluginMarketplace,
  getMarketplacePluginVersionState,
} from "../lib/plugin-marketplace.js";

describe("PluginMarketplace", () => {
  it("loads local marketplace entries and resolves source/readme paths", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-marketplace-"));
    try {
      fs.mkdirSync(path.join(dir, "plugins", "demo"), { recursive: true });
      fs.writeFileSync(path.join(dir, "plugins", "demo", "manifest.json"), "{}", "utf8");
      fs.writeFileSync(path.join(dir, "README-demo.md"), "# Demo\n\nHello", "utf8");
      const indexPath = path.join(dir, "marketplace.json");
      fs.writeFileSync(indexPath, JSON.stringify({
        schemaVersion: 1,
        plugins: [{
          schemaVersion: 1,
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "1.0.0",
          description: "Demo plugin",
          repository: "https://example.com/demo",
          compatibility: { minAppVersion: "0.170.0" },
          trust: "restricted",
          permissions: ["task.read"],
          contributions: ["tools"],
          distribution: { kind: "source", path: "plugins/demo" },
          readmePath: "README-demo.md",
        }],
      }), "utf8");

      const marketplace = new PluginMarketplace({ indexPath });
      const data = await marketplace.load();
      const plugin = data.plugins[0];

      expect(plugin).toMatchObject({
        id: "demo",
        name: "Demo",
        distribution: {
          kind: "source",
          path: "plugins/demo",
          resolvedPath: path.join(dir, "plugins", "demo"),
        },
      });
      expect(marketplace.resolveSourceDistribution(plugin)).toBe(path.join(dir, "plugins", "demo"));
      await expect(marketplace.getReadme("demo")).resolves.toContain("# Demo");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty marketplace when no source is configured", async () => {
    const marketplace = new PluginMarketplace();
    await expect(marketplace.load()).resolves.toMatchObject({
      source: { kind: "none", configured: false },
      plugins: [],
    });
  });

  it("uses the official OH-Plugins marketplace URL by default", async () => {
    const marketplace = createDefaultPluginMarketplace({
      env: {},
      fetchImpl: async (url) => {
        expect(url).toBe(DEFAULT_OFFICIAL_PLUGIN_MARKETPLACE_URL);
        return Response.json({ schemaVersion: 1, plugins: [] });
      },
    });

    await expect(marketplace.load()).resolves.toMatchObject({
      source: {
        kind: "url",
        configured: true,
        url: DEFAULT_OFFICIAL_PLUGIN_MARKETPLACE_URL,
      },
      plugins: [],
    });
  });

  it("resolves readmePath relative to URL marketplaces", async () => {
    const marketplace = new PluginMarketplace({
      indexUrl: "https://raw.githubusercontent.com/liliMozi/OH-Plugins/main/marketplace.json",
      fetchImpl: async (url) => {
        if (url.endsWith("/marketplace.json")) {
          return Response.json({
            schemaVersion: 1,
            plugins: [{
              schemaVersion: 1,
              id: "demo",
              name: "Demo",
              publisher: "Hana",
              version: "1.0.0",
              description: "Demo plugin",
              repository: "https://example.com/demo",
              compatibility: { minAppVersion: "0.170.0" },
              trust: "restricted",
              permissions: [],
              contributions: ["tools"],
              distribution: { kind: "release", packageUrl: "https://example.com/demo.zip", sha256: "a".repeat(64) },
              readmePath: "plugins/demo/README.md",
            }],
          });
        }
        expect(url).toBe("https://raw.githubusercontent.com/liliMozi/OH-Plugins/main/plugins/demo/README.md");
        return new Response("# Demo from URL");
      },
    });

    const data = await marketplace.load();
    expect(data.plugins[0].readmePath).toBeNull();
    expect(data.plugins[0].readmeUrl).toBe("https://raw.githubusercontent.com/liliMozi/OH-Plugins/main/plugins/demo/README.md");
    await expect(marketplace.getReadme("demo")).resolves.toBe("# Demo from URL");
  });

  it("normalizes catalog versions and selects the highest version compatible with the app", async () => {
    const marketplace = new PluginMarketplace({
      indexUrl: "https://example.com/marketplace.json",
      fetchImpl: async () => Response.json({
        schemaVersion: 1,
        plugins: [{
          id: "demo",
          name: "Demo",
          publisher: "Hana",
          version: "2.0.0",
          description: "Demo plugin",
          trust: "restricted",
          versions: [
            {
              version: "2.0.0",
              compatibility: { minAppVersion: "99.0.0" },
              distribution: { kind: "release", packageUrl: "https://example.com/demo-2.zip", sha256: "2".repeat(64) },
            },
            {
              version: "1.5.0",
              compatibility: { minAppVersion: "0.180.0" },
              distribution: { kind: "release", packageUrl: "https://example.com/demo-1.5.zip", sha256: "1".repeat(64) },
            },
            {
              version: "1.0.0",
              compatibility: { minAppVersion: "0.170.0" },
              distribution: { kind: "release", packageUrl: "https://example.com/demo-1.zip", sha256: "0".repeat(64) },
            },
          ],
          readme: "# Demo",
        }],
      }),
    });

    const data = await marketplace.load();
    const plugin = data.plugins[0];
    const state = getMarketplacePluginVersionState(plugin, {
      appVersion: "0.190.2",
      installedVersion: "1.0.0",
    });

    expect(plugin.version).toBe("2.0.0");
    expect(plugin.versions.map((item) => item.version)).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
    expect(state).toMatchObject({
      latestVersion: "2.0.0",
      selectedVersion: "1.5.0",
      installedVersion: "1.0.0",
      updateAvailable: true,
      downgrade: false,
      compatible: true,
      installAction: "update",
    });
    expect(state.selectedDistribution.packageUrl).toBe("https://example.com/demo-1.5.zip");
  });

  it("marks compatible downgrades and incompatible plugins explicitly", async () => {
    const plugin = {
      id: "demo",
      name: "Demo",
      version: "2.0.0",
      versions: [
        {
          version: "2.0.0",
          compatibility: { minAppVersion: "99.0.0" },
          distribution: { kind: "release", packageUrl: "https://example.com/demo-2.zip", sha256: "2".repeat(64) },
        },
        {
          version: "1.0.0",
          compatibility: { minAppVersion: "0.170.0" },
          distribution: { kind: "release", packageUrl: "https://example.com/demo-1.zip", sha256: "1".repeat(64) },
        },
      ],
    };

    expect(getMarketplacePluginVersionState(plugin, {
      appVersion: "0.190.2",
      installedVersion: "1.5.0",
    })).toMatchObject({
      latestVersion: "2.0.0",
      selectedVersion: "1.0.0",
      downgrade: true,
      updateAvailable: false,
      compatible: true,
      installAction: "downgrade",
    });

    expect(getMarketplacePluginVersionState(plugin, {
      appVersion: "0.100.0",
      installedVersion: null,
    })).toMatchObject({
      latestVersion: "2.0.0",
      selectedVersion: null,
      compatible: false,
      canInstall: false,
      installAction: "incompatible",
    });
  });
});
