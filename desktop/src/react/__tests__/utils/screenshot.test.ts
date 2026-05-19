/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => storeMock.state,
  },
}));

import { takeArticleScreenshot, takeScreenshot } from '../../utils/screenshot';

describe('screenshot utils', () => {
  const notices: Array<{ text: string; type: string; deskDir?: string }> = [];
  const noticeHandler = (event: Event) => {
    notices.push((event as CustomEvent).detail);
  };

  beforeEach(() => {
    notices.length = 0;
    storeMock.state = {
      homeFolder: '/tmp/hana-home',
      chatSessions: {},
      selectedIdsBySession: {},
      currentAgentId: null,
      agentName: 'Hana',
      userName: '我',
      beginScreenshotTask: vi.fn(),
      updateScreenshotProgress: vi.fn(),
      endScreenshotTask: vi.fn(),
    };
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    window.addEventListener('hana-inline-notice', noticeHandler);
    (window as any).t = (key: string) => (
      key === 'common.screenshotFailed' ? '截图保存失败'
        : key === 'common.screenshotSaved' ? '截图已保存'
          : key
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.removeEventListener('hana-inline-notice', noticeHandler);
    delete (window as any).hana;
    delete (window as any).t;
  });

  it('主进程 IPC reject 时，给用户发出明确失败提示而不是变成未处理异常', async () => {
    (window as any).hana = {
      screenshotRender: vi.fn().mockRejectedValue(new Error('disk full')),
    };

    await expect(takeArticleScreenshot('# hello')).resolves.toBeUndefined();

    expect((window as any).hana.screenshotRender).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('disk full'),
      }),
    ]);
  });

  it('按截图页更新页码，并按选中的消息块数推进总进度', async () => {
    const sessionPath = '/session/a.jsonl';
    storeMock.state = {
      ...storeMock.state,
      selectedIdsBySession: {
        [sessionPath]: ['u1', 'a1', 'u2', 'a2'],
      },
      chatSessions: {
        [sessionPath]: {
          hasMore: false,
          loadingMore: false,
          items: [
            { type: 'message', data: { id: 'u1', role: 'user', text: '问'.repeat(6000) } },
            { type: 'message', data: { id: 'a1', role: 'assistant', blocks: [{ type: 'text', html: `<p>${'答'.repeat(6000)}</p>` }] } },
            { type: 'message', data: { id: 'u2', role: 'user', text: '再问'.repeat(3000) } },
            { type: 'message', data: { id: 'a2', role: 'assistant', blocks: [{ type: 'text', html: `<p>${'再答'.repeat(3000)}</p>` }] } },
          ],
        },
      },
    };
    (window as any).hana = {
      screenshotRender: vi.fn().mockResolvedValue({ success: true, dir: '/tmp/hana-home/截图' }),
      getServerPort: vi.fn().mockResolvedValue(null),
      getServerToken: vi.fn().mockResolvedValue(null),
    };

    await expect(takeScreenshot('u1', sessionPath)).resolves.toBeUndefined();

    expect(storeMock.state.beginScreenshotTask).toHaveBeenCalledWith({
      completedBlocks: 0,
      totalBlocks: 4,
      currentPage: 1,
      totalPages: 2,
    });
    expect(storeMock.state.updateScreenshotProgress).toHaveBeenCalledWith({ currentPage: 1 });
    expect(storeMock.state.updateScreenshotProgress).toHaveBeenCalledWith({ completedBlocks: 2 });
    expect(storeMock.state.updateScreenshotProgress).toHaveBeenCalledWith({ currentPage: 2 });
    expect(storeMock.state.updateScreenshotProgress).toHaveBeenCalledWith({ completedBlocks: 4 });
    expect(storeMock.state.endScreenshotTask).toHaveBeenCalledOnce();
    expect((window as any).hana.screenshotRender).toHaveBeenCalledTimes(2);
    expect((window as any).hana.screenshotRender).toHaveBeenNthCalledWith(1, expect.objectContaining({
      segmentIndex: 1,
      segmentTotal: 2,
    }));
    expect((window as any).hana.screenshotRender).toHaveBeenNthCalledWith(2, expect.objectContaining({
      segmentIndex: 2,
      segmentTotal: 2,
    }));
  });
});
