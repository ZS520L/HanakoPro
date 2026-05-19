export const PLUGIN_UI_PROTOCOL = 'hana.plugin.ui' as const;
export const PLUGIN_UI_PROTOCOL_VERSION = 1 as const;

export const PLUGIN_UI_ERROR_CODE = {
  BAD_MESSAGE: 'BAD_MESSAGE',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  SLOT_DENIED: 'SLOT_DENIED',
  TIMEOUT: 'TIMEOUT',
  HOST_ERROR: 'HOST_ERROR',
} as const;

export const PLUGIN_UI_CAPABILITY = {
  TOAST_SHOW: 'toast.show',
  EXTERNAL_OPEN: 'external.open',
  SESSION_FILE_OPEN: 'sessionFile.open',
  UI_RESIZE: 'ui.resize',
  CLIPBOARD_WRITE_TEXT: 'clipboard.writeText',
} as const;

export type PluginUiErrorCode =
  (typeof PLUGIN_UI_ERROR_CODE)[keyof typeof PLUGIN_UI_ERROR_CODE];

export type PluginUiCapabilityName =
  (typeof PLUGIN_UI_CAPABILITY)[keyof typeof PLUGIN_UI_CAPABILITY];

export type PluginUiSlot = 'page' | 'widget' | 'card' | 'settings';

export type PluginUiMessageKind = 'event' | 'request' | 'response' | 'error';

export interface PluginUiError {
  code: PluginUiErrorCode | string;
  message: string;
  details?: unknown;
}

export interface PluginUiMessage {
  protocol: typeof PLUGIN_UI_PROTOCOL;
  version: typeof PLUGIN_UI_PROTOCOL_VERSION;
  id?: string;
  kind: PluginUiMessageKind;
  type: string;
  payload?: unknown;
  error?: PluginUiError;
}

export type PluginUiParseResult =
  | { ok: true; value: PluginUiMessage }
  | {
      ok: false;
      error: {
        code:
          | typeof PLUGIN_UI_ERROR_CODE.BAD_MESSAGE
          | typeof PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION;
        message: string;
      };
    };

const MESSAGE_KINDS = new Set<PluginUiMessageKind>([
  'event',
  'request',
  'response',
  'error',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function badMessage(message: string): PluginUiParseResult {
  return {
    ok: false,
    error: {
      code: PLUGIN_UI_ERROR_CODE.BAD_MESSAGE,
      message,
    },
  };
}

export function parsePluginUiMessage(value: unknown): PluginUiParseResult {
  if (!isObject(value)) {
    return badMessage('Plugin UI messages must be objects.');
  }

  if (value.protocol !== PLUGIN_UI_PROTOCOL) {
    return badMessage('Plugin UI message protocol is missing or invalid.');
  }

  if (value.version !== PLUGIN_UI_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION,
        message: `Unsupported Plugin UI protocol version: ${String(value.version)}.`,
      },
    };
  }

  if (typeof value.kind !== 'string' || !MESSAGE_KINDS.has(value.kind as PluginUiMessageKind)) {
    return badMessage('Plugin UI message kind is missing or invalid.');
  }

  if (typeof value.type !== 'string' || value.type.trim() === '') {
    return badMessage('Plugin UI message type must be a non-empty string.');
  }

  const kind = value.kind as PluginUiMessageKind;
  if (kind !== 'event' && (typeof value.id !== 'string' || value.id.trim() === '')) {
    return badMessage(`Plugin UI ${kind} messages must include a non-empty id.`);
  }

  if (kind === 'error') {
    if (!isObject(value.error)) {
      return badMessage('Plugin UI error messages must include an error object.');
    }
    if (typeof value.error.code !== 'string' || value.error.code.trim() === '') {
      return badMessage('Plugin UI error code must be a non-empty string.');
    }
    if (typeof value.error.message !== 'string' || value.error.message.trim() === '') {
      return badMessage('Plugin UI error message must be a non-empty string.');
    }
  }

  return {
    ok: true,
    value: value as unknown as PluginUiMessage,
  };
}

export function isPluginUiMessage(value: unknown): value is PluginUiMessage {
  return parsePluginUiMessage(value).ok;
}
