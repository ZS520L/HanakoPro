import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/use-stream-buffer', () => ({
  streamBufferManager: {
    handle: vi.fn(),
    splitForUserInterjection: vi.fn(),
  },
}));

vi.mock('../../stores/session-actions', () => ({
  loadSessions: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  loadDeskFiles: vi.fn(),
}));

vi.mock('../../stores/channel-actions', () => ({
  loadChannels: vi.fn(),
  openChannel: vi.fn(),
}));

vi.mock('../../stores/preview-actions', () => ({
  handleLegacyArtifactBlock: vi.fn(),
}));

vi.mock('../../services/app-event-actions', () => ({
  handleAppEvent: vi.fn(),
}));

vi.mock('../../services/stream-resume', () => ({
  replayStreamResume: vi.fn(),
  isStreamResumeRebuilding: () => null,
  isStreamScopedMessage: () => false,
  updateSessionStreamMeta: vi.fn(),
}));

vi.mock('../../services/stream-key-dispatcher', () => ({
  dispatchStreamKey: vi.fn(),
}));

import { streamBufferManager } from '../../hooks/use-stream-buffer';
import { useStore } from '../../stores';
import { applyStreamingStatus, configureWsMessageHandler, handleServerMessage } from '../../services/ws-message-handler';
import { dispatchStreamKey } from '../../services/stream-key-dispatcher';
import { handleAppEvent } from '../../services/app-event-actions';
import { clearMessageLiveVersion, readMessageLiveVersion } from '../../stores/message-live-version';

describe('ws-message-handler applyStreamingStatus', () => {
  beforeEach(() => {
    useStore.setState({
      currentSessionPath: '/focused.jsonl',
      pendingNewSession: false,
      sessions: [],
      streamingSessions: [],
      inlineErrors: {},
    } as never);
  });

  it('isStreaming=true 对传入的 path 做 addStreamingSession（即使不是焦点 session）', () => {
    applyStreamingStatus(true, '/other.jsonl');
    expect(useStore.getState().streamingSessions).toEqual(['/other.jsonl']);
  });

  it('isStreaming=false 对传入的 path 做 removeStreamingSession（非焦点 session 也必须清）', () => {
    useStore.setState({ streamingSessions: ['/focused.jsonl', '/other.jsonl'] } as never);
    applyStreamingStatus(false, '/other.jsonl');
    expect(useStore.getState().streamingSessions).toEqual(['/focused.jsonl']);
  });

  it('stream_resume 场景：服务端返回 isStreaming=false，前端把焦点 session 从 streamingSessions 移除', () => {
    useStore.setState({ streamingSessions: ['/focused.jsonl'] } as never);
    applyStreamingStatus(false, '/focused.jsonl');
    expect(useStore.getState().streamingSessions).toEqual([]);
  });

  it('isStreaming=true 时重复调用不会产生重复 path', () => {
    applyStreamingStatus(true, '/focused.jsonl');
    applyStreamingStatus(true, '/focused.jsonl');
    expect(useStore.getState().streamingSessions).toEqual(['/focused.jsonl']);
  });

  it('sessionPath 为 null 不抛错（防御调用方漏传）', () => {
    useStore.setState({ streamingSessions: ['/focused.jsonl'] } as never);
    expect(() => applyStreamingStatus(false, null)).not.toThrow();
    expect(useStore.getState().streamingSessions).toEqual(['/focused.jsonl']);
  });
});

describe('ws-message-handler session-scoped desktop events', () => {
  beforeEach(() => {
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      pendingNewSession: false,
      sessions: [{
        path: '/session/a.jsonl',
        title: 'A',
        firstMessage: 'hello',
        modified: '2026-04-24T10:00:00.000Z',
        messageCount: 1,
        agentId: 'a1',
        agentName: 'Hana',
        cwd: null,
      }],
      chatSessions: {},
      streamingSessions: [],
      computerOverlayBySession: {},
    } as never);
    clearMessageLiveVersion('/session/a.jsonl');
    useStore.getState().clearSession('/session/a.jsonl');
    useStore.getState().initSession('/session/a.jsonl', [], false);
  });

  it('session_user_message 直接把 user message 追加到对应桌面 session', () => {
    handleServerMessage({
      type: 'session_user_message',
      sessionPath: '/session/a.jsonl',
      message: {
        text: 'hello from bridge',
        quotedText: 'quote',
        attachments: [{ path: '/tmp/a.png', name: 'a.png', isDir: false }],
      },
    });

    const items = useStore.getState().chatSessions['/session/a.jsonl']?.items || [];
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first?.type).toBe('message');
    if (!first || first.type !== 'message') throw new Error('expected message item');
    expect(first.data.role).toBe('user');
    expect(first.data.text).toBe('hello from bridge');
    expect(first.data.quotedText).toBe('quote');
    expect(first.data.attachments).toEqual([{ path: '/tmp/a.png', name: 'a.png', isDir: false }]);
  });

  it('stream replay 中的 session_user_message 若已由历史加载存在，不重复追加', () => {
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: {
        id: 'hist-0',
        role: 'user',
        text: 'hello from bridge',
        textHtml: 'hello from bridge',
        attachments: [{ path: '/tmp/a.png', name: 'a.png', isDir: false }],
        quotedText: 'quote',
      },
    });

    handleServerMessage({
      type: 'session_user_message',
      sessionPath: '/session/a.jsonl',
      __fromReplay: true,
      message: {
        text: 'hello from bridge',
        quotedText: 'quote',
        attachments: [{ path: '/tmp/a.png', name: 'a.png', isDir: false }],
      },
    });

    const items = useStore.getState().chatSessions['/session/a.jsonl']?.items || [];
    expect(items).toHaveLength(1);
  });

  it('session_branch_reset 只截断目标会话尾部并提升 message live version', () => {
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: { id: 'u1', role: 'user', text: 'old' },
    });
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: { id: 'a1', role: 'assistant', blocks: [] },
    });
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: { id: 'client-u2', sourceEntryId: 'entry-u2', role: 'user', text: 'retry' },
    });
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: { id: 'a2', role: 'assistant', blocks: [] },
    });

    handleServerMessage({
      type: 'session_branch_reset',
      sessionPath: '/session/a.jsonl',
      messageId: 'entry-u2',
      clientMessageId: 'client-u2',
    });

    const items = useStore.getState().chatSessions['/session/a.jsonl']?.items || [];
    expect(items.map(item => item.type === 'message' ? item.data.id : item.id)).toEqual(['u1', 'a1']);
    expect(readMessageLiveVersion('/session/a.jsonl')).toBe(1);
  });

  it('computer_overlay 写入当前 session 的 overlay keyed 状态并支持 clear', () => {
    handleServerMessage({
      type: 'computer_overlay',
      sessionPath: '/session/a.jsonl',
      phase: 'running',
      action: 'click_element',
      leaseId: 'lease-1',
      snapshotId: 'snapshot-1',
      visualSurface: 'provider',
      target: { coordinateSpace: 'element', elementId: 'mock-button' },
      ts: 100,
    });

    expect(useStore.getState().computerOverlayBySession['/session/a.jsonl']).toMatchObject({
      phase: 'running',
      action: 'click_element',
      leaseId: 'lease-1',
      visualSurface: 'provider',
    });

    handleServerMessage({
      type: 'computer_overlay',
      sessionPath: '/session/a.jsonl',
      phase: 'clear',
      action: 'stop',
      ts: 101,
    });

    expect(useStore.getState().computerOverlayBySession['/session/a.jsonl']).toBeUndefined();
  });

  it('tool_end 带 sessionFile 时更新 session registry 文件状态', () => {
    handleServerMessage({
      type: 'tool_end',
      sessionPath: '/session/a.jsonl',
      name: 'write',
      success: true,
      details: {
        sessionFile: {
          fileId: 'sf_write',
          filePath: '/workspace/draft.md',
          label: 'draft.md',
          operations: ['created'],
        },
      },
    });

    expect(useStore.getState().sessionRegistryFilesByPath['/session/a.jsonl']).toEqual([
      expect.objectContaining({
        fileId: 'sf_write',
        filePath: '/workspace/draft.md',
        operations: ['created'],
      }),
    ]);
  });

  it('todo_write 全部 completed 时按生命周期移除当前 session todo', () => {
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      todosBySession: {
        '/session/a.jsonl': [{ content: 'old', activeForm: 'doing old', status: 'in_progress' }],
      },
      todosLiveVersionBySession: {},
    } as never);

    handleServerMessage({
      type: 'tool_end',
      sessionPath: '/session/a.jsonl',
      name: 'todo_write',
      success: true,
      details: {
        todos: [
          { content: 'old', activeForm: 'doing old', status: 'completed' },
        ],
      },
    });

    expect(useStore.getState().todosBySession['/session/a.jsonl']).toEqual([]);
    expect(useStore.getState().todosLiveVersionBySession['/session/a.jsonl']).toBe(1);
  });

  it('todo_update 事件按 sessionPath 更新 keyed todos', () => {
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      todosBySession: {
        '/session/a.jsonl': [{ content: 'a', activeForm: 'doing a', status: 'pending' }],
        '/session/b.jsonl': [{ content: 'b', activeForm: 'doing b', status: 'pending' }],
      },
    } as never);

    handleServerMessage({
      type: 'todo_update',
      sessionPath: '/session/b.jsonl',
      todos: [],
    });

    expect(useStore.getState().todosBySession['/session/a.jsonl']).toEqual([
      { content: 'a', activeForm: 'doing a', status: 'pending' },
    ]);
    expect(useStore.getState().todosBySession['/session/b.jsonl']).toEqual([]);
  });

  it('bridge_rc_attached / detached 直接补丁 sessions 列表上的接管态', () => {
    handleServerMessage({
      type: 'bridge_rc_attached',
      sessionPath: '/session/a.jsonl',
      sessionKey: 'feishu_dm_1@a1',
      platform: 'feishu',
      title: 'A',
    });

    expect(useStore.getState().sessions[0]?.rcAttachment).toEqual({
      sessionKey: 'feishu_dm_1@a1',
      platform: 'feishu',
      title: 'A',
    });

    handleServerMessage({
      type: 'bridge_rc_detached',
      sessionPath: '/session/a.jsonl',
    });

    expect(useStore.getState().sessions[0]?.rcAttachment).toBeNull();
  });
});

describe('ws-message-handler background chat stream routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      pendingNewSession: false,
      sessions: [
        {
          path: '/session/a.jsonl',
          title: 'A',
          firstMessage: 'hello',
          modified: '2026-04-24T10:00:00.000Z',
          messageCount: 1,
          agentId: 'a1',
          agentName: 'Hana',
          cwd: null,
        },
        {
          path: '/session/b.jsonl',
          title: 'B',
          firstMessage: 'hi',
          modified: '2026-04-24T10:01:00.000Z',
          messageCount: 1,
          agentId: 'a1',
          agentName: 'Hana',
          cwd: null,
        },
      ],
      chatSessions: {},
      streamingSessions: [],
    } as never);
    useStore.getState().clearSession('/session/a.jsonl');
    useStore.getState().clearSession('/session/b.jsonl');
    useStore.getState().initSession('/session/a.jsonl', [], false);
    useStore.getState().initSession('/session/b.jsonl', [], false);
  });

  it('非当前 session 的正文流也进入主聊天 buffer，同时保留 streamKey 预览分发', () => {
    const msg = {
      type: 'text_delta',
      sessionPath: '/session/b.jsonl',
      delta: '后台正文',
    };

    handleServerMessage(msg);

    expect(streamBufferManager.handle).toHaveBeenCalledWith(msg);
    expect(dispatchStreamKey).toHaveBeenCalledWith('/session/b.jsonl', msg);
  });
});

describe('ws-message-handler compaction lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      pendingNewSession: false,
      sessions: [
        {
          path: '/session/a.jsonl',
          title: 'A',
          firstMessage: 'hello',
          modified: '2026-04-24T10:00:00.000Z',
          messageCount: 1,
          agentId: 'a1',
          agentName: 'Hana',
          cwd: null,
        },
        {
          path: '/session/b.jsonl',
          title: 'B',
          firstMessage: 'hi',
          modified: '2026-04-24T10:01:00.000Z',
          messageCount: 1,
          agentId: 'a1',
          agentName: 'Hana',
          cwd: null,
        },
      ],
      chatSessions: {},
      compactingSessions: [],
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      contextBySession: {},
    } as never);
  });

  it('tracks compaction_start for a background session before stream routing returns', () => {
    handleServerMessage({
      type: 'compaction_start',
      sessionPath: '/session/b.jsonl',
      reason: 'threshold',
    });

    expect(useStore.getState().compactingSessions).toEqual(['/session/b.jsonl']);
  });

  it('tracks compaction_end and preserves the provided context window when tokens are unknown', () => {
    useStore.setState({
      compactingSessions: ['/session/b.jsonl'],
    } as never);

    handleServerMessage({
      type: 'compaction_end',
      sessionPath: '/session/b.jsonl',
      tokens: null,
      contextWindow: 200_000,
      percent: null,
    });

    expect(useStore.getState().compactingSessions).toEqual([]);
    expect(useStore.getState().contextBySession['/session/b.jsonl']).toEqual({
      tokens: null,
      window: 200_000,
      percent: null,
    });
  });

  it('preserves context_usage window even when tokens are unknown', () => {
    handleServerMessage({
      type: 'context_usage',
      sessionPath: '/session/a.jsonl',
      tokens: null,
      contextWindow: 200_000,
      percent: null,
    });

    expect(useStore.getState().contextBySession['/session/a.jsonl']).toEqual({
      tokens: null,
      window: 200_000,
      percent: null,
    });
  });
});

describe('ws-message-handler app events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureWsMessageHandler({});
  });

  it('app_event 消息会 route 到 handleAppEvent', () => {
    handleServerMessage({
      type: 'app_event',
      event: {
        type: 'models-changed',
        payload: { reason: 'provider' },
      },
    });

    expect(handleAppEvent).toHaveBeenCalledWith('models-changed', { reason: 'provider' });
  });
});

describe('ws-message-handler turn_end side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      pendingNewSession: false,
      sessions: [{
        path: '/session/a.jsonl',
        title: 'A',
        firstMessage: 'hello',
        modified: '2026-04-24T10:00:00.000Z',
        messageCount: 1,
        agentId: 'a1',
        agentName: 'Hana',
        cwd: null,
      }],
      chatSessions: {},
      streamingSessions: [],
    } as never);
  });

  it('turn_end requests context usage through the injected callback', () => {
    const requestContextUsage = vi.fn();
    configureWsMessageHandler({ requestContextUsage });

    handleServerMessage({
      type: 'turn_end',
      sessionPath: '/session/a.jsonl',
    });

    expect(requestContextUsage).toHaveBeenCalledWith('/session/a.jsonl');
  });
});
