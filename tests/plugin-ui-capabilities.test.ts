/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_UI_CAPABILITY } from '@hana/plugin-protocol';
import { DEFAULT_PLUGIN_UI_CAPABILITIES } from '../desktop/src/react/plugin-ui/capabilities';
import { useStore } from '../desktop/src/react/stores';
import type { PluginUiRequestContext } from '../desktop/src/react/plugin-ui/plugin-ui-host-controller';

const context: PluginUiRequestContext = {
  pluginId: 'demo-plugin',
  slot: 'page',
  routeUrl: 'http://127.0.0.1:3210/api/plugins/demo/page',
  origin: 'http://127.0.0.1:3210',
  iframeWindow: {} as Window,
  grantedCapabilities: new Set(),
};

function capability(name: string) {
  const cap = DEFAULT_PLUGIN_UI_CAPABILITIES.find(item => item.name === name);
  if (!cap) throw new Error(`missing capability: ${name}`);
  return cap;
}

describe('default plugin UI capabilities', () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
    (window as any).platform = {
      openExternal: vi.fn(),
    };
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  it('shows a host toast without a capability grant', async () => {
    const cap = capability(PLUGIN_UI_CAPABILITY.TOAST_SHOW);

    expect(cap.requiresGrant).toBe(false);
    expect(cap.validatePayload({ message: 'hello', type: 'success', duration: 1200 })).toEqual({
      ok: true,
      value: { message: 'hello', type: 'success', duration: 1200 },
    });
    await expect(cap.handle(context, { message: 'hello', type: 'success', duration: 1200 })).resolves.toEqual({
      shown: true,
    });
    expect(useStore.getState().toasts.at(-1)).toMatchObject({
      text: 'hello',
      type: 'success',
    });
  });

  it('validates and opens http or https URLs through the platform bridge', async () => {
    const cap = capability(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN);
    const payload = { url: 'https://example.com/docs' };

    expect(cap.requiresGrant).toBe(true);
    expect(cap.allowedSlots).toEqual(['page', 'widget', 'settings']);
    expect(cap.validatePayload(payload)).toEqual({ ok: true, value: payload });
    await expect(cap.handle(context, payload)).resolves.toEqual({ opened: true });
    expect((window as any).platform.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('rejects non-web external URLs', () => {
    const cap = capability(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN);

    expect(cap.validatePayload({ url: 'file:///private/etc/passwd' })).toEqual({
      ok: false,
      error: 'external.open requires an http or https URL.',
    });
  });

  it('writes text to clipboard only with a string payload', async () => {
    const cap = capability(PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT);

    expect(cap.requiresGrant).toBe(true);
    expect(cap.validatePayload({ text: 'copy me' })).toEqual({
      ok: true,
      value: { text: 'copy me' },
    });
    await expect(cap.handle(context, { text: 'copy me' })).resolves.toEqual({ written: true });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
  });
});
