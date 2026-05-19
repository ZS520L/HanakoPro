import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PluginConfigValidationError,
  createPluginConfigStore,
  normalizePluginConfigSchema,
} from "../core/plugin-config.js";

describe("plugin config schema", () => {
  it("normalizes fields and materializes global defaults", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-config-"));
    try {
      const schema = normalizePluginConfigSchema("demo", {
        properties: {
          enabled: { type: "boolean", default: true, title: "Enabled" },
          token: { type: "string", sensitive: true },
        },
      });
      const store = createPluginConfigStore({ dataDir: dir, schema });

      expect(store.get("enabled")).toBe(true);
      store.set("token", "abc");
      expect(store.getAll({ redacted: true })).toEqual({ enabled: true, token: "********" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid type writes with field errors", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-config-"));
    try {
      const schema = normalizePluginConfigSchema("demo", {
        properties: {
          interval: { type: "integer" },
        },
      });
      const store = createPluginConfigStore({ dataDir: dir, schema });

      expect(() => store.set("interval", 1.5)).toThrow(PluginConfigValidationError);
      try {
        store.set("interval", 1.5);
      } catch (err) {
        expect(err.errors[0]).toMatchObject({ key: "interval", code: "INVALID_TYPE" });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps scoped values in their own keyed containers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-config-"));
    try {
      const schema = normalizePluginConfigSchema("demo", {
        properties: {
          agentMode: { type: "string", scope: "per-agent" },
        },
      });
      const store = createPluginConfigStore({ dataDir: dir, schema });

      store.set("agentMode", "strict", { scope: "per-agent", agentId: "hanako" });

      expect(store.get("agentMode", { scope: "per-agent", agentId: "hanako" })).toBe("strict");
      expect(store.getState()).toMatchObject({
        agents: {
          hanako: { agentMode: "strict" },
        },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads old flat config files as global config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-config-"));
    try {
      fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ oldKey: "old" }), "utf-8");
      const store = createPluginConfigStore({
        dataDir: dir,
        schema: normalizePluginConfigSchema("demo", {}),
      });

      expect(store.get("oldKey")).toBe("old");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes optional keys when a patch value is undefined", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-plugin-config-"));
    try {
      const schema = normalizePluginConfigSchema("image-gen", {
        properties: {
          defaultImageModel: { type: "object" },
          providerDefaults: { type: "object" },
        },
      });
      const store = createPluginConfigStore({ dataDir: dir, schema });

      store.set("defaultImageModel", { id: "gpt-image-1", provider: "openai" });
      store.setMany({
        defaultImageModel: undefined,
        providerDefaults: { openai: { size: "1024x1024" } },
      });

      expect(store.getAll()).toEqual({
        providerDefaults: { openai: { size: "1024x1024" } },
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
