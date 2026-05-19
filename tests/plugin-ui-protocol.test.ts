import { describe, it, expect } from 'vitest';
import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_ERROR_CODE,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
  parsePluginUiMessage,
} from '@hana/plugin-protocol';

describe('plugin UI protocol', () => {
  it('accepts a versioned event envelope', () => {
    const result = parsePluginUiMessage({
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      kind: 'event',
      type: 'hana.ready',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        protocol: 'hana.plugin.ui',
        version: 1,
        kind: 'event',
        type: 'hana.ready',
      },
    });
  });

  it('requires request, response, and error messages to carry an id', () => {
    const result = parsePluginUiMessage({
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      kind: 'request',
      type: 'toast.show',
      payload: { message: 'hello' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: PLUGIN_UI_ERROR_CODE.BAD_MESSAGE,
        message: 'Plugin UI request messages must include a non-empty id.',
      },
    });
  });

  it('reports unsupported protocol versions separately from malformed messages', () => {
    const result = parsePluginUiMessage({
      protocol: PLUGIN_UI_PROTOCOL,
      version: 2,
      kind: 'event',
      type: 'hana.ready',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION,
        message: 'Unsupported Plugin UI protocol version: 2.',
      },
    });
  });

  it('exports the initial host capability names as stable constants', () => {
    expect(PLUGIN_UI_CAPABILITY).toEqual({
      TOAST_SHOW: 'toast.show',
      EXTERNAL_OPEN: 'external.open',
      SESSION_FILE_OPEN: 'sessionFile.open',
      UI_RESIZE: 'ui.resize',
      CLIPBOARD_WRITE_TEXT: 'clipboard.writeText',
    });
  });
});
