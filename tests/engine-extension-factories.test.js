import { describe, expect, it, vi } from "vitest";
import { HanaEngine } from "../core/engine.js";

function makeFactory(name) {
  return Object.assign(() => {}, { _testName: name });
}

function names(factories) {
  return factories.map((factory) => factory._testName);
}

function makeEngine({ pluginFactories = [] } = {}) {
  const engine = Object.create(HanaEngine.prototype);
  engine._coreExtensionFactories = [
    makeFactory("core-provider"),
    makeFactory("core-image"),
  ];
  engine._frameworkExtFactories = [];
  engine._extensionFactories = [...engine._coreExtensionFactories];
  engine._pluginManager = {
    getExtensionFactories: vi.fn(() => pluginFactories),
  };
  engine._resourceLoader = {
    reload: vi.fn().mockResolvedValue(undefined),
  };
  return engine;
}

describe("HanaEngine extension factories", () => {
  it("reloads ResourceLoader after plugin extension factories are synced", async () => {
    const engine = makeEngine({
      pluginFactories: [makeFactory("plugin-a")],
    });

    await engine.syncPluginExtensions();

    expect(names(engine._extensionFactories)).toEqual([
      "core-provider",
      "core-image",
      "plugin-a",
    ]);
    expect(engine._resourceLoader.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps all core factories when framework factories are registered later", async () => {
    const engine = makeEngine({
      pluginFactories: [makeFactory("plugin-a")],
    });
    const frameworkFactory = makeFactory("framework-deferred");

    await engine.registerExtensionFactory(frameworkFactory);

    expect(names(engine._extensionFactories)).toEqual([
      "core-provider",
      "core-image",
      "framework-deferred",
      "plugin-a",
    ]);
    expect(engine._resourceLoader.reload).toHaveBeenCalledTimes(1);
  });
});
