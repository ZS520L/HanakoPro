// tests/plugin-ui-contributions.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PluginManager } from '../core/plugin-manager.js';
import { PLUGIN_UI_CAPABILITY } from '@hana/plugin-protocol';

function tmpPluginDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hana-plugin-test-'));
}

function createPluginWithPage(dir, id = 'test-page-plugin') {
  const pluginDir = path.join(dir, id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
    id,
    trust: 'full-access',
    contributes: {
      page: {
        title: { zh: '测试', en: 'Test' },
        icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
        route: '/dashboard',
      },
    },
  }));
  fs.writeFileSync(path.join(pluginDir, 'routes', 'dashboard.js'), `
    export default function(app) {
      app.get('/dashboard', (c) => c.text('ok'));
    }
  `);
}

function makePM(communityDir) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-data-'));
  const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-builtin-'));
  return new PluginManager({
    pluginsDirs: [builtinDir, communityDir],
    dataDir,
    bus: { emit() {}, subscribe() { return () => {}; } },
    preferencesManager: {
      getAllowFullAccessPlugins: () => true,
      getDisabledPlugins: () => [],
    },
  });
}

describe('Plugin UI Contributions', () => {
  let tmpDir;
  let pm;

  beforeEach(() => { tmpDir = tmpPluginDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('loads page contribution from manifest', async () => {
    createPluginWithPage(tmpDir);
    pm = makePM(tmpDir);
    await pm.loadAll();
    const pages = pm.getPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].pluginId).toBe('test-page-plugin');
    expect(pages[0].title).toEqual({ zh: '测试', en: 'Test' });
    expect(pages[0].route).toBe('/dashboard');
    expect(pages[0].hostCapabilities).toEqual([]);
  });

  it('loads declared UI host capability grants for page contributions', async () => {
    const pluginDir = path.join(tmpDir, 'grant-page-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      manifestVersion: 1,
      id: 'grant-page-plugin',
      trust: 'full-access',
      ui: {
        hostCapabilities: [
          PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
          'unknown.capability',
          PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
        ],
      },
      contributes: {
        page: { title: 'Grant Page', route: '/page' },
      },
    }));
    fs.writeFileSync(path.join(pluginDir, 'routes', 'page.js'), 'export default function(app) {}');

    pm = makePM(tmpDir);
    await pm.loadAll();

    expect(pm.getPages()[0].hostCapabilities).toEqual([
      PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
      PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
    ]);
  });

  it('ignores page from restricted plugin', async () => {
    const pluginDir = path.join(tmpDir, 'restricted-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'restricted-plugin',
      contributes: { page: { title: 'Test', route: '/page' } },
    }));
    fs.writeFileSync(path.join(pluginDir, 'routes', 'page.js'), 'export default function(app) {}');
    pm = makePM(tmpDir);
    await pm.loadAll();
    expect(pm.getPages()).toHaveLength(0);
  });

  it('loads widget contribution from manifest', async () => {
    const pluginDir = path.join(tmpDir, 'widget-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'widget-plugin',
      trust: 'full-access',
      contributes: { widget: { title: 'Monitor', icon: null, route: '/sidebar' } },
    }));
    fs.writeFileSync(path.join(pluginDir, 'routes', 'sidebar.js'), 'export default function(app) {}');
    pm = makePM(tmpDir);
    await pm.loadAll();
    const widgets = pm.getWidgets();
    expect(widgets).toHaveLength(1);
    expect(widgets[0].pluginId).toBe('widget-plugin');
    expect(widgets[0].route).toBe('/sidebar');
    expect(widgets[0].hostCapabilities).toEqual([]);
  });

  it('loads declared UI host capability grants for widget contributions', async () => {
    const pluginDir = path.join(tmpDir, 'grant-widget-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      manifestVersion: 1,
      id: 'grant-widget-plugin',
      trust: 'full-access',
      ui: {
        hostCapabilities: [PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN],
      },
      contributes: {
        widget: { title: 'Grant Widget', route: '/widget' },
      },
    }));
    fs.writeFileSync(path.join(pluginDir, 'routes', 'widget.js'), 'export default function(app) {}');

    pm = makePM(tmpDir);
    await pm.loadAll();

    expect(pm.getWidgets()[0].hostCapabilities).toEqual([
      PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
    ]);
  });

  it('loads both page and widget when both declared', async () => {
    const pluginDir = path.join(tmpDir, 'both-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(path.join(pluginDir, 'routes'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'both-plugin',
      trust: 'full-access',
      contributes: {
        page: { title: 'Page', route: '/page' },
        widget: { title: 'Widget', route: '/widget' },
      },
    }));
    fs.writeFileSync(path.join(pluginDir, 'routes', 'page.js'), 'export default function(app) {}');
    pm = makePM(tmpDir);
    await pm.loadAll();
    expect(pm.getPages()).toHaveLength(1);
    expect(pm.getWidgets()).toHaveLength(1);
    expect(pm.getPages()[0].pluginId).toBe('both-plugin');
    expect(pm.getWidgets()[0].pluginId).toBe('both-plugin');
  });

  it('loads hidden built-in native settings tab contributions', async () => {
    const builtinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-builtin-settings-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-data-settings-'));
    try {
      const pluginDir = path.join(builtinDir, 'mcp');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
        id: 'mcp',
        name: 'MCP',
        hidden: true,
        trust: 'full-access',
        contributes: {
          settingsTab: {
            id: 'mcp',
            title: { zh: 'MCP', en: 'MCP' },
            nativeComponent: 'mcp.settings',
          },
        },
      }));

      pm = new PluginManager({
        pluginsDirs: [builtinDir, tmpDir],
        dataDir,
        bus: { emit() {}, subscribe() { return () => {}; } },
        preferencesManager: {
          getAllowFullAccessPlugins: () => false,
          getDisabledPlugins: () => [],
        },
      });
      await pm.loadAll();

      expect(pm.listPlugins().find(p => p.id === 'mcp')?.hidden).toBe(true);
      expect(pm.getSettingsTabs()).toEqual([
        {
          pluginId: 'mcp',
          id: 'mcp',
          title: { zh: 'MCP', en: 'MCP' },
          icon: null,
          nativeComponent: 'mcp.settings',
        },
      ]);
    } finally {
      fs.rmSync(builtinDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('ignores native settings tab contributions from community plugins', async () => {
    const pluginDir = path.join(tmpDir, 'community-settings');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({
      id: 'community-settings',
      trust: 'full-access',
      contributes: {
        settingsTab: {
          id: 'community-settings',
          title: 'Community Settings',
          nativeComponent: 'mcp.settings',
        },
      },
    }));

    pm = makePM(tmpDir);
    await pm.loadAll();

    expect(pm.getSettingsTabs()).toEqual([]);
  });
});
