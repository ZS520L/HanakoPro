/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PLUGIN_UI_CAPABILITY } from '@hana/plugin-protocol';
import { useStore } from '../../stores';
import { PluginCardBlock } from '../../components/chat/PluginCardBlock';
import { usePluginIframe } from '../../hooks/use-plugin-iframe';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('../../hooks/use-plugin-iframe', () => ({
  usePluginIframe: vi.fn(() => ({
    iframeRef: { current: null },
    status: 'ready',
    size: {},
  })),
}));

describe('PluginCardBlock manifest grants', () => {
  afterEach(() => {
    cleanup();
    useStore.setState({ pluginUiHostCapabilities: {} } as any);
    vi.mocked(usePluginIframe).mockClear();
  });

  it('passes plugin-level UI host capability grants into the iframe hook', () => {
    useStore.setState({
      pluginUiHostCapabilities: {
        demo: [PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN],
      },
    } as any);

    render(
      <PluginCardBlock
        card={{ type: 'iframe', pluginId: 'demo', route: '/card', title: 'Demo', description: 'fallback' }}
        agentId="butter"
      />,
    );

    expect(usePluginIframe).toHaveBeenCalledWith(
      expect.stringContaining('/api/plugins/demo/card'),
      expect.objectContaining({
        pluginId: 'demo',
        slot: 'card',
        capabilityGrants: [PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN],
      }),
    );
  });
});
