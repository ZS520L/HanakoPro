/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePluginIframe } from '../../hooks/use-plugin-iframe';
import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_ERROR_CODE,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
} from '@hana/plugin-protocol';
import type { PluginUiCapability } from '../../plugin-ui/plugin-ui-host-controller';

const switchTab = vi.fn();

vi.mock('../../components/channels/ChannelTabBar', () => ({
  switchTab: (...args: unknown[]) => switchTab(...args),
}));

function attachIframeWindow(iframe: HTMLIFrameElement, contentWindow: Window & { postMessage: ReturnType<typeof vi.fn> }) {
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: contentWindow,
  });
}

function Harness({
  routeUrl,
  capabilities,
  capabilityGrants,
}: {
  routeUrl: string | null;
  capabilities?: PluginUiCapability[];
  capabilityGrants?: string[];
}) {
  const { iframeRef, status, postToIframe } = usePluginIframe(routeUrl, {
    pluginId: 'demo-plugin',
    capabilities,
    capabilityGrants,
  });
  return (
    <div>
      <div data-testid="status">{status}</div>
      <iframe ref={iframeRef} data-testid="iframe" />
      <button onClick={() => postToIframe('visibility-changed', { visible: true })}>post</button>
    </div>
  );
}

describe('usePluginIframe', () => {
  afterEach(() => {
    cleanup();
    switchTab.mockReset();
  });

  it('只接受来自预期 iframe 窗口和 origin 的 ready 消息', () => {
    render(<Harness routeUrl="http://127.0.0.1:3210/api/plugins/demo/page?token=abc" />);
    const iframe = screen.getByTestId('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ready' },
        origin: 'http://evil.test',
        source: trustedWindow,
      }));
    });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ready' },
        origin: 'http://127.0.0.1:3210',
        source: { postMessage: vi.fn() } as unknown as Window,
      }));
    });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'ready' },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it('navigate-tab 只接受可信消息，postToIframe 使用精确 targetOrigin', async () => {
    render(<Harness routeUrl="http://127.0.0.1:3210/api/plugins/demo/widget?token=abc" />);
    const iframe = screen.getByTestId('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'navigate-tab', payload: { tab: 'channels' } },
        origin: 'http://evil.test',
        source: trustedWindow,
      }));
    });
    await Promise.resolve();
    expect(switchTab).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'navigate-tab', payload: { tab: 'channels' } },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });
    await waitFor(() => expect(switchTab).toHaveBeenCalledWith('channels'));

    fireEvent.click(screen.getByText('post'));
    expect(trustedWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'visibility-changed',
        payload: { visible: true },
        seq: 1,
      }),
      'http://127.0.0.1:3210',
    );
  });

  it('接受可信 iframe 发来的新版 SDK ready / resize envelope', () => {
    render(<Harness routeUrl="http://127.0.0.1:3210/api/plugins/demo/page?token=abc" />);
    const iframe = screen.getByTestId('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          kind: 'event',
          type: 'hana.ready',
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    expect(screen.getByTestId('status').textContent).toBe('ready');

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          kind: 'event',
          type: PLUGIN_UI_CAPABILITY.UI_RESIZE,
          payload: { height: 320 },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    expect(iframe.style.height).toBe('320px');
  });

  it('把可信 iframe 的 host request 分发给 capability 并回传 response', async () => {
    const handle = vi.fn(async () => ({ shown: true }));
    const capabilities: PluginUiCapability[] = [{
      name: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
      allowedSlots: ['page'],
      requiresGrant: true,
      validatePayload: (payload) => ({ ok: true, value: payload }),
      handle,
    }];
    render(
      <Harness
        routeUrl="http://127.0.0.1:3210/api/plugins/demo/page?token=abc"
        capabilities={capabilities}
        capabilityGrants={[PLUGIN_UI_CAPABILITY.TOAST_SHOW]}
      />,
    );
    const iframe = screen.getByTestId('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: 'req-1',
          kind: 'request',
          type: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
          payload: { message: 'hello' },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    await waitFor(() => expect(trustedWindow.postMessage).toHaveBeenCalledWith({
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      id: 'req-1',
      kind: 'response',
      type: PLUGIN_UI_CAPABILITY.TOAST_SHOW,
      payload: { shown: true },
    }, 'http://127.0.0.1:3210'));
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'demo-plugin',
      slot: 'page',
      routeUrl: 'http://127.0.0.1:3210/api/plugins/demo/page?token=abc',
      origin: 'http://127.0.0.1:3210',
      iframeWindow: trustedWindow,
    }), { message: 'hello' });
  });

  it('未授权 host request 返回 capability denied 错误', async () => {
    const capabilities: PluginUiCapability[] = [{
      name: PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
      allowedSlots: ['page'],
      requiresGrant: true,
      validatePayload: (payload) => ({ ok: true, value: payload }),
      handle: vi.fn(async () => ({ opened: true })),
    }];
    render(
      <Harness
        routeUrl="http://127.0.0.1:3210/api/plugins/demo/page?token=abc"
        capabilities={capabilities}
      />,
    );
    const iframe = screen.getByTestId('iframe') as HTMLIFrameElement;
    const trustedWindow = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
    attachIframeWindow(iframe, trustedWindow);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: 'req-2',
          kind: 'request',
          type: PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
          payload: { url: 'https://example.com' },
        },
        origin: 'http://127.0.0.1:3210',
        source: trustedWindow,
      }));
    });

    await waitFor(() => expect(trustedWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'req-2',
        kind: 'error',
        type: PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
        error: expect.objectContaining({
          code: PLUGIN_UI_ERROR_CODE.CAPABILITY_DENIED,
        }),
      }),
      'http://127.0.0.1:3210',
    ));
  });
});
