import { describe, expect, it, vi } from 'vitest';
import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_ERROR_CODE,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
} from '@hana/plugin-protocol';
import {
  handlePluginUiRequest,
  type PluginUiCapability,
  type PluginUiRequestContext,
} from '../desktop/src/react/plugin-ui/plugin-ui-host-controller';

const baseContext: PluginUiRequestContext = {
  pluginId: 'demo-plugin',
  slot: 'page',
  routeUrl: 'http://127.0.0.1:3210/api/plugins/demo-plugin/page',
  origin: 'http://127.0.0.1:3210',
  iframeWindow: {} as Window,
  grantedCapabilities: new Set([PLUGIN_UI_CAPABILITY.TOAST_SHOW]),
};

function request(type: string, payload?: unknown) {
  return {
    protocol: PLUGIN_UI_PROTOCOL,
    version: PLUGIN_UI_PROTOCOL_VERSION,
    id: 'req-1',
    kind: 'request' as const,
    type,
    payload,
  };
}

describe('plugin UI host capability controller', () => {
  it('dispatches an allowed request and returns a protocol response', async () => {
    const handle = vi.fn(async (_ctx: PluginUiRequestContext, payload: unknown) => ({
      received: payload,
    }));
    const capabilities: PluginUiCapability[] = [{
      name: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
      allowedSlots: ['page', 'widget', 'card', 'settings'],
      requiresGrant: true,
      validatePayload: (payload) => ({ ok: true, value: payload }),
      handle,
    }];

    await expect(handlePluginUiRequest({
      message: request(PLUGIN_UI_CAPABILITY.TOAST_SHOW, { message: 'hello' }),
      context: baseContext,
      capabilities,
    })).resolves.toEqual({
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      id: 'req-1',
      kind: 'response',
      type: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
      payload: { received: { message: 'hello' } },
    });
    expect(handle).toHaveBeenCalledWith(baseContext, { message: 'hello' });
  });

  it('rejects unknown request types with a protocol error', async () => {
    await expect(handlePluginUiRequest({
      message: request('unknown.capability'),
      context: baseContext,
      capabilities: [],
    })).resolves.toMatchObject({
      kind: 'error',
      id: 'req-1',
      type: 'unknown.capability',
      error: {
        code: PLUGIN_UI_ERROR_CODE.UNKNOWN_TYPE,
      },
    });
  });

  it('enforces slot and grant boundaries before calling handlers', async () => {
    const handle = vi.fn(async () => ({ ok: true }));
    const capability: PluginUiCapability = {
      name: PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
      allowedSlots: ['page'],
      requiresGrant: true,
      validatePayload: (payload) => ({ ok: true, value: payload }),
      handle,
    };

    await expect(handlePluginUiRequest({
      message: request(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN, { url: 'https://example.com' }),
      context: { ...baseContext, slot: 'card' },
      capabilities: [capability],
    })).resolves.toMatchObject({
      kind: 'error',
      error: { code: PLUGIN_UI_ERROR_CODE.SLOT_DENIED },
    });

    await expect(handlePluginUiRequest({
      message: request(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN, { url: 'https://example.com' }),
      context: { ...baseContext, grantedCapabilities: new Set() },
      capabilities: [capability],
    })).resolves.toMatchObject({
      kind: 'error',
      error: { code: PLUGIN_UI_ERROR_CODE.CAPABILITY_DENIED },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('returns BAD_MESSAGE when payload validation fails', async () => {
    const capability: PluginUiCapability = {
      name: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
      allowedSlots: ['page'],
      requiresGrant: false,
      validatePayload: () => ({ ok: false, error: 'message is required' }),
      handle: vi.fn(async () => ({ ok: true })),
    };

    await expect(handlePluginUiRequest({
      message: request(PLUGIN_UI_CAPABILITY.TOAST_SHOW, {}),
      context: baseContext,
      capabilities: [capability],
    })).resolves.toMatchObject({
      kind: 'error',
      error: {
        code: PLUGIN_UI_ERROR_CODE.BAD_MESSAGE,
        message: 'message is required',
      },
    });
  });
});
