// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from '../../components/chat/AssistantMessage';
import { UserMessage } from '../../components/chat/UserMessage';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('../../utils/screenshot', () => ({
  takeScreenshot: vi.fn(),
}));

describe('expired session file presentation', () => {
  beforeEach(() => {
    const tMap: Record<string, string> = {
      'chat.fileExpired': '文件已过期',
      'desk.openWithDefault': '用默认应用打开',
      'chat.fileActions.more': '更多文件操作',
      'chat.fileActions.revealInFinder': '打开文件夹',
      'chat.fileActions.copyPath': '复制文件路径',
    };
    window.t = ((key: string) => tMap[key] || key) as typeof window.t;
    window.platform = {
      getFileUrl: vi.fn((filePath: string) => `file://${filePath}`),
      openFile: vi.fn(),
      showInFinder: vi.fn(),
    } as unknown as typeof window.platform;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders an expired assistant file block as a disabled file card', () => {
    render(
      <AssistantMessage
        showAvatar={false}
        sessionPath="/sessions/main.jsonl"
        readOnly
        message={{
          id: 'a1',
          role: 'assistant',
          blocks: [
            {
              type: 'file',
              fileId: 'sf_old',
              filePath: '/cache/old.pdf',
              label: 'old.pdf',
              ext: 'pdf',
              status: 'expired',
              missingAt: 1234,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('old.pdf')).toBeInTheDocument();
    expect(screen.getByText('文件已过期')).toBeInTheDocument();
    expect(screen.queryByTitle('desk.openWithDefault')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('old.pdf'));
    expect(window.platform?.openFile).not.toHaveBeenCalled();
  });

  it('does not load image previews for expired user attachments', () => {
    render(
      <UserMessage
        showAvatar={false}
        sessionPath="/sessions/main.jsonl"
        readOnly
        message={{
          id: 'u1',
          role: 'user',
          textHtml: '',
          attachments: [
            {
              fileId: 'sf_img',
              path: '/cache/old.png',
              name: 'old.png',
              isDir: false,
              mimeType: 'image/png',
              status: 'expired',
              missingAt: 1234,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByRole('img', { name: 'old.png' })).not.toBeInTheDocument();
    expect(screen.getByText('old.png · 文件已过期')).toBeInTheDocument();
    expect(window.platform?.getFileUrl).not.toHaveBeenCalled();
  });

  it('renders assistant file actions as a split button with reveal and copy menu actions', async () => {
    render(
      <AssistantMessage
        showAvatar={false}
        sessionPath="/sessions/main.jsonl"
        readOnly
        message={{
          id: 'a2',
          role: 'assistant',
          blocks: [
            {
              type: 'file',
              fileId: 'sf_demo',
              filePath: '/cache/demo.pdf',
              label: 'demo.pdf',
              ext: 'pdf',
              status: 'available',
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '用默认应用打开 demo.pdf' }));
    expect(window.platform?.openFile).toHaveBeenCalledWith('/cache/demo.pdf');

    fireEvent.click(screen.getByRole('button', { name: '更多文件操作 demo.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件夹' }));
    expect(window.platform?.showInFinder).toHaveBeenCalledWith('/cache/demo.pdf');

    fireEvent.click(screen.getByRole('button', { name: '更多文件操作 demo.pdf' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制文件路径' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/cache/demo.pdf');
  });
});
