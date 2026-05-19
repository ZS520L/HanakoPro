// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React, { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import { AppPages } from '../../components/app/AppPages';

vi.mock('../../MainContent', () => ({
  MainContent: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="main-content">{children}</main>
  ),
}));

vi.mock('../../components/PreviewPanel', () => ({
  PreviewPanel: () => <aside data-testid="preview-panel" />,
}));

vi.mock('../../components/right-workspace/RightWorkspacePanel', () => ({
  RightWorkspacePanel: () => <section data-testid="right-workspace-panel" />,
}));

vi.mock('../../components/plugin/PluginPageView', () => ({
  PluginPageView: ({ pluginId }: { pluginId: string }) => (
    <section data-testid="plugin-page">{pluginId}</section>
  ),
}));

vi.mock('../../components/chat/ChatArea', () => ({
  ChatArea: () => <section data-testid="chat-area" />,
}));

vi.mock('../../components/InputArea', () => ({
  InputArea: () => <section data-testid="input-area" />,
}));

vi.mock('../../components/WelcomeScreen', () => ({
  WelcomeScreen: () => <section data-testid="welcome-screen" />,
}));

vi.mock('../../components/ChannelsPanel', () => ({
  ChannelMessages: () => <section data-testid="channel-messages" />,
  ChannelMembers: () => <section data-testid="channel-members" />,
  ChannelInput: () => <section data-testid="channel-input" />,
  ChannelReadonly: () => <section data-testid="channel-readonly" />,
  ChannelAgentActivityPanel: () => <section data-testid="channel-agent-activity" />,
  ChannelAgentSettingsPanel: () => <section data-testid="channel-agent-settings" />,
}));

vi.mock('../../components/channels/ChannelHeader', () => ({
  ChannelHeader: () => <section data-testid="channel-header" />,
}));

vi.mock('../../components/ActivityPanel', () => ({
  ActivityPanel: () => <section data-testid="activity-panel" />,
}));

vi.mock('../../components/AutomationPanel', () => ({
  AutomationPanel: () => <section data-testid="automation-panel" />,
}));

vi.mock('../../components/BridgePanel', () => ({
  BridgePanel: () => <section data-testid="bridge-panel" />,
}));

describe('AppPages page ownership', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
    useStore.setState({
      currentTab: 'chat',
      welcomeVisible: false,
      currentSessionPath: '/sessions/main.jsonl',
      currentChannel: null,
      channelIsDM: false,
      channelMembers: [],
      channelInfoName: '',
      jianOpen: true,
      previewOpen: true,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the file preview only on the chat page', () => {
    const ref = createRef<HTMLDivElement>();
    render(<AppPages inputCardRef={ref} />);

    expect(screen.getByTestId('chat-area')).toBeInTheDocument();
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
    expect(screen.getByTestId('right-workspace-panel')).toBeInTheDocument();
  });

  it('keeps the workspace companion on plugin pages without carrying the file preview', () => {
    useStore.setState({ currentTab: 'plugin:hanako-hyperframes' } as never);
    const ref = createRef<HTMLDivElement>();

    render(<AppPages inputCardRef={ref} />);

    expect(screen.getByTestId('plugin-page')).toHaveTextContent('hanako-hyperframes');
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('right-workspace-panel')).toBeInTheDocument();
  });

  it('keeps channel inspector and workspace companion as separate right-side panels', () => {
    useStore.setState({
      currentTab: 'channels',
      currentChannel: 'ch_crew',
      channelMembers: ['hanako', 'butter'],
      channelInfoName: 'Crew',
    } as never);
    const ref = createRef<HTMLDivElement>();

    render(<AppPages inputCardRef={ref} />);

    expect(screen.getByTestId('channel-messages')).toBeInTheDocument();
    expect(screen.getByTestId('channel-members')).toBeInTheDocument();
    expect(screen.getByTestId('channel-agent-activity')).toBeInTheDocument();
    expect(screen.getByTestId('channel-agent-settings')).toBeInTheDocument();
    expect(
      screen.getByTestId('channel-agent-settings').compareDocumentPosition(screen.getByTestId('channel-agent-activity'))
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('right-workspace-panel')).toBeInTheDocument();
  });
});
