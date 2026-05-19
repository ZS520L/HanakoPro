import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
  parsePluginUiMessage,
  type PluginUiError,
  type PluginUiMessage,
} from '@hana/plugin-protocol';

export interface HanaPluginSize {
  width?: number;
  height?: number;
}

export interface HanaPluginThemeSnapshot {
  theme?: string;
  cssUrl?: string;
}

export interface HanaPluginRequestOptions {
  timeoutMs?: number;
}

export type HanaToastType = 'success' | 'error' | 'info' | 'warning';

export interface HanaToastShowInput {
  message: string;
  type?: HanaToastType;
  duration?: number;
}

export interface HanaToastShowResult {
  shown: boolean;
}

export type HanaExternalOpenInput = string | { url: string };

export interface HanaExternalOpenResult {
  opened: boolean;
}

export type HanaClipboardWriteTextInput = string | { text: string };

export interface HanaClipboardWriteTextResult {
  written: boolean;
}

export interface HanaPluginSdkOptions {
  parentWindow?: Window;
  targetWindow?: Window;
  targetOrigin?: string;
  requestTimeoutMs?: number;
  idFactory?: () => string;
}

export interface HanaPluginSdk {
  ready(payload?: unknown): void;
  ui: {
    resize(size: HanaPluginSize): void;
  };
  theme: {
    getSnapshot(): HanaPluginThemeSnapshot;
    subscribe(callback: (theme: HanaPluginThemeSnapshot) => void): () => void;
  };
  host: {
    request<T = unknown>(
      type: string,
      payload?: unknown,
      options?: HanaPluginRequestOptions,
    ): Promise<T>;
  };
  toast: {
    show(input: HanaToastShowInput, options?: HanaPluginRequestOptions): Promise<HanaToastShowResult>;
  };
  external: {
    open(input: HanaExternalOpenInput, options?: HanaPluginRequestOptions): Promise<HanaExternalOpenResult>;
  };
  clipboard: {
    writeText(
      input: HanaClipboardWriteTextInput,
      options?: HanaPluginRequestOptions,
    ): Promise<HanaClipboardWriteTextResult>;
  };
}

export class HanaPluginError extends Error {
  override name = 'HanaPluginError';
  readonly code: string;
  readonly details?: unknown;

  constructor(error: PluginUiError) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

let fallbackIdSeq = 0;

function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackIdSeq += 1;
  return `hana-plugin-${Date.now()}-${fallbackIdSeq}`;
}

function getBrowserWindow(): Window {
  if (typeof window === 'undefined') {
    throw new Error('@hana/plugin-sdk requires a browser iframe window.');
  }
  return window;
}

function safeOriginFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveTargetOrigin(targetWindow: Window, explicit?: string): string {
  if (explicit) return explicit;

  const hostOrigin = new URLSearchParams(targetWindow.location.search).get('hana-host-origin');
  if (hostOrigin) return hostOrigin;

  return safeOriginFromUrl(targetWindow.document.referrer) ?? '*';
}

function readInitialTheme(targetWindow: Window): HanaPluginThemeSnapshot {
  const params = new URLSearchParams(targetWindow.location.search);
  return {
    theme: params.get('hana-theme') ?? undefined,
    cssUrl: params.get('hana-css') ?? undefined,
  };
}

function isTrustedHostEvent(event: MessageEvent, parentWindow: Window, targetOrigin: string): boolean {
  if (event.source !== parentWindow) return false;
  if (targetOrigin !== '*' && event.origin !== targetOrigin) return false;
  return true;
}

function externalOpenPayload(input: HanaExternalOpenInput): { url: string } {
  return typeof input === 'string' ? { url: input } : input;
}

function clipboardWriteTextPayload(input: HanaClipboardWriteTextInput): { text: string } {
  return typeof input === 'string' ? { text: input } : input;
}

export function createHanaPluginSdk(options: HanaPluginSdkOptions = {}): HanaPluginSdk {
  const targetWindow = options.targetWindow ?? getBrowserWindow();
  const parentWindow = options.parentWindow ?? targetWindow.parent;
  const targetOrigin = resolveTargetOrigin(targetWindow, options.targetOrigin);
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const idFactory = options.idFactory ?? defaultIdFactory;
  let themeSnapshot = readInitialTheme(targetWindow);
  const themeSubscribers = new Set<(theme: HanaPluginThemeSnapshot) => void>();

  function post(message: PluginUiMessage): void {
    parentWindow.postMessage(message, targetOrigin);
  }

  function postEvent(type: string, payload?: unknown): void {
    const message: PluginUiMessage = {
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      kind: 'event',
      type,
    };
    if (payload !== undefined) message.payload = payload;
    post(message);
  }

  function onThemeMessage(event: MessageEvent): void {
    if (!isTrustedHostEvent(event, parentWindow, targetOrigin)) return;
    const parsed = parsePluginUiMessage(event.data);
    if (!parsed.ok) return;

    const message = parsed.value;
    if (message.kind !== 'event' || message.type !== 'hana.theme.changed') return;
    if (typeof message.payload !== 'object' || message.payload === null) return;

    const payload = message.payload as Record<string, unknown>;
    themeSnapshot = {
      theme: typeof payload.theme === 'string' ? payload.theme : themeSnapshot.theme,
      cssUrl: typeof payload.cssUrl === 'string' ? payload.cssUrl : themeSnapshot.cssUrl,
    };
    for (const callback of themeSubscribers) callback(themeSnapshot);
  }

  function request<T = unknown>(
    type: string,
    payload?: unknown,
    requestOptions: HanaPluginRequestOptions = {},
  ): Promise<T> {
    const id = idFactory();
    const timeoutMs = requestOptions.timeoutMs ?? requestTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        targetWindow.removeEventListener('message', onMessage);
        targetWindow.clearTimeout(timeout);
      };

      const onMessage = (event: MessageEvent) => {
        if (!isTrustedHostEvent(event, parentWindow, targetOrigin)) return;
        const parsed = parsePluginUiMessage(event.data);
        if (!parsed.ok) return;

        const message = parsed.value;
        if (message.id !== id || message.type !== type) return;

        if (message.kind === 'response') {
          cleanup();
          resolve(message.payload as T);
        }
        if (message.kind === 'error' && message.error) {
          cleanup();
          reject(new HanaPluginError(message.error));
        }
      };

      const timeout = targetWindow.setTimeout(() => {
        cleanup();
        reject(new HanaPluginError({
          code: 'TIMEOUT',
          message: `Plugin host request timed out: ${type}.`,
        }));
      }, timeoutMs);

      targetWindow.addEventListener('message', onMessage);

      const message: PluginUiMessage = {
        protocol: PLUGIN_UI_PROTOCOL,
        version: PLUGIN_UI_PROTOCOL_VERSION,
        id,
        kind: 'request',
        type,
      };
      if (payload !== undefined) message.payload = payload;
      post(message);
    });
  }

  return {
    ready(payload?: unknown) {
      postEvent('hana.ready', payload);
    },
    ui: {
      resize(size: HanaPluginSize) {
        postEvent(PLUGIN_UI_CAPABILITY.UI_RESIZE, size);
      },
    },
    theme: {
      getSnapshot() {
        return { ...themeSnapshot };
      },
      subscribe(callback: (theme: HanaPluginThemeSnapshot) => void) {
        if (themeSubscribers.size === 0) {
          targetWindow.addEventListener('message', onThemeMessage);
        }
        themeSubscribers.add(callback);
        callback({ ...themeSnapshot });
        return () => {
          themeSubscribers.delete(callback);
          if (themeSubscribers.size === 0) {
            targetWindow.removeEventListener('message', onThemeMessage);
          }
        };
      },
    },
    host: {
      request,
    },
    toast: {
      show(input: HanaToastShowInput, options?: HanaPluginRequestOptions) {
        return request<HanaToastShowResult>(PLUGIN_UI_CAPABILITY.TOAST_SHOW, input, options);
      },
    },
    external: {
      open(input: HanaExternalOpenInput, options?: HanaPluginRequestOptions) {
        return request<HanaExternalOpenResult>(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN, externalOpenPayload(input), options);
      },
    },
    clipboard: {
      writeText(input: HanaClipboardWriteTextInput, options?: HanaPluginRequestOptions) {
        return request<HanaClipboardWriteTextResult>(
          PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
          clipboardWriteTextPayload(input),
          options,
        );
      },
    },
  };
}

let singleton: HanaPluginSdk | null = null;

function getSingleton(): HanaPluginSdk {
  singleton ??= createHanaPluginSdk();
  return singleton;
}

export const hana: HanaPluginSdk = {
  ready(payload?: unknown) {
    return getSingleton().ready(payload);
  },
  ui: {
    resize(size: HanaPluginSize) {
      return getSingleton().ui.resize(size);
    },
  },
  theme: {
    getSnapshot() {
      return getSingleton().theme.getSnapshot();
    },
    subscribe(callback: (theme: HanaPluginThemeSnapshot) => void) {
      return getSingleton().theme.subscribe(callback);
    },
  },
  host: {
    request<T = unknown>(
      type: string,
      payload?: unknown,
      options?: HanaPluginRequestOptions,
    ) {
      return getSingleton().host.request<T>(type, payload, options);
    },
  },
  toast: {
    show(input: HanaToastShowInput, options?: HanaPluginRequestOptions) {
      return getSingleton().toast.show(input, options);
    },
  },
  external: {
    open(input: HanaExternalOpenInput, options?: HanaPluginRequestOptions) {
      return getSingleton().external.open(input, options);
    },
  },
  clipboard: {
    writeText(input: HanaClipboardWriteTextInput, options?: HanaPluginRequestOptions) {
      return getSingleton().clipboard.writeText(input, options);
    },
  },
};
