import { PLUGIN_UI_CAPABILITY } from '@hana/plugin-protocol';
import { useStore } from '../stores';
import type { Toast } from '../stores/toast-slice';
import type {
  PluginUiCapability,
  PluginUiPayloadValidationResult,
  PluginUiRequestContext,
} from './plugin-ui-host-controller';

const TOAST_TYPES = new Set<Toast['type']>(['success', 'error', 'info', 'warning']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateToastPayload(payload: unknown): PluginUiPayloadValidationResult {
  if (!isObject(payload) || typeof payload.message !== 'string' || payload.message.trim() === '') {
    return { ok: false, error: 'toast.show requires a non-empty message.' };
  }
  const type = typeof payload.type === 'string' && TOAST_TYPES.has(payload.type as Toast['type'])
    ? payload.type as Toast['type']
    : 'info';
  const duration = typeof payload.duration === 'number' && Number.isFinite(payload.duration) && payload.duration >= 0
    ? payload.duration
    : 5000;
  return {
    ok: true,
    value: {
      message: payload.message,
      type,
      duration,
    },
  };
}

function validateExternalOpenPayload(payload: unknown): PluginUiPayloadValidationResult {
  if (!isObject(payload) || typeof payload.url !== 'string') {
    return { ok: false, error: 'external.open requires a URL string.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(payload.url);
  } catch {
    return { ok: false, error: 'external.open requires a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'external.open requires an http or https URL.' };
  }
  return { ok: true, value: { url: parsed.toString() } };
}

function validateClipboardWriteTextPayload(payload: unknown): PluginUiPayloadValidationResult {
  if (!isObject(payload) || typeof payload.text !== 'string') {
    return { ok: false, error: 'clipboard.writeText requires a text string.' };
  }
  return { ok: true, value: { text: payload.text } };
}

async function showToast(_ctx: PluginUiRequestContext, payload: unknown): Promise<unknown> {
  const { message, type, duration } = payload as {
    message: string;
    type: Toast['type'];
    duration: number;
  };
  useStore.getState().addToast(message, type, duration);
  return { shown: true };
}

async function openExternal(_ctx: PluginUiRequestContext, payload: unknown): Promise<unknown> {
  const { url } = payload as { url: string };
  window.platform?.openExternal?.(url);
  return { opened: true };
}

async function writeClipboardText(_ctx: PluginUiRequestContext, payload: unknown): Promise<unknown> {
  const { text } = payload as { text: string };
  await navigator.clipboard.writeText(text);
  return { written: true };
}

export const DEFAULT_PLUGIN_UI_CAPABILITIES: readonly PluginUiCapability[] = [
  {
    name: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
    allowedSlots: ['page', 'widget', 'card', 'settings'],
    requiresGrant: false,
    validatePayload: validateToastPayload,
    handle: showToast,
  },
  {
    name: PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
    allowedSlots: ['page', 'widget', 'settings'],
    requiresGrant: true,
    validatePayload: validateExternalOpenPayload,
    handle: openExternal,
  },
  {
    name: PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
    allowedSlots: ['page', 'widget', 'settings'],
    requiresGrant: true,
    validatePayload: validateClipboardWriteTextPayload,
    handle: writeClipboardText,
  },
];
