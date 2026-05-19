import type { ReactNode, RefObject } from 'react';
import { useStore } from '../../stores';
import { ActivityPanel } from '../ActivityPanel';
import { AutomationPanel } from '../AutomationPanel';
import { BridgePanel } from '../BridgePanel';
import { PreviewPanel } from '../PreviewPanel';
import { RightWorkspacePanel } from '../right-workspace/RightWorkspacePanel';
import { PluginPageView } from '../plugin/PluginPageView';
import { InputArea } from '../InputArea';
import { WelcomeScreen } from '../WelcomeScreen';
import { ChatArea } from '../chat/ChatArea';
import { ChannelMessages, ChannelMembers, ChannelInput, ChannelReadonly, ChannelAgentActivityPanel, ChannelAgentSettingsPanel } from '../ChannelsPanel';
import { ChannelHeader } from '../channels/ChannelHeader';
import { MainContent } from '../../MainContent';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';

const tr = (key: string, vars?: Record<string, string | number>) => window.t?.(key, vars) ?? key;

function WelcomeContainer() {
  const visible = useStore(s => s.welcomeVisible);
  return (
    <div className={`welcome${visible ? '' : ' hidden'}`} id="welcome">
      <WelcomeScreen />
    </div>
  );
}

function ChatPage({ inputCardRef }: { inputCardRef: RefObject<HTMLDivElement | null> }) {
  const welcomeVisible = useStore(s => s.welcomeVisible);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const hasPanels = !welcomeVisible && !!currentSessionPath;

  return (
    <>
      <div className={`chat-area${hasPanels ? ' has-panels' : ''}`}>
        <WelcomeContainer />
        <RegionalErrorBoundary region="chat" resetKeys={[currentSessionPath]}>
          <ChatArea />
        </RegionalErrorBoundary>
      </div>
      <div className="input-area">
        <RegionalErrorBoundary region="input" resetKeys={[currentSessionPath]}>
          <InputArea key={currentSessionPath || '__new'} cardRef={inputCardRef} />
        </RegionalErrorBoundary>
      </div>
    </>
  );
}

function ChannelInputArea() {
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);

  if (!currentChannel) return null;

  if (isDM) {
    return (
      <div className="channel-readonly-notice">
        <ChannelReadonly />
      </div>
    );
  }

  return (
    <div className="channel-input-area">
      <ChannelInput />
    </div>
  );
}

function ChannelInspectorShell({ children }: { children: ReactNode }) {
  return (
    <aside className="channel-inspector-rail" id="channelInspector" data-channel-inspector="">
      <div className="resize-handle resize-handle-left" id="channelInspectorResizeHandle"></div>
      {children}
    </aside>
  );
}

function ChannelInspectorPanel() {
  const channelInfoName = useStore(s => s.channelInfoName);
  const isDM = useStore(s => s.channelIsDM);
  const currentChannel = useStore(s => s.currentChannel);

  if (!currentChannel) return null;

  if (isDM) {
    return (
      <ChannelInspectorShell>
        <div className="channel-info-stack">
          <div className="jian-card">
            <div className="channel-info-section">
              <div className="channel-info-label">{tr('channel.dmLabel')}</div>
              <div className="channel-members-list">
                <ChannelMembers />
              </div>
            </div>
          </div>
          <ChannelAgentSettingsPanel />
          <ChannelAgentActivityPanel />
        </div>
      </ChannelInspectorShell>
    );
  }

  return (
    <ChannelInspectorShell>
      <div className="channel-info-stack">
        <div className="jian-card">
          <div className="channel-info-section">
            <div className="channel-info-label">{tr('channel.info')}</div>
            <div className="channel-info-name">{channelInfoName}</div>
          </div>
          <div className="channel-info-section">
            <div className="channel-info-label">{tr('channel.members')}</div>
            <div className="channel-members-list">
              <ChannelMembers />
            </div>
          </div>
        </div>
        <ChannelAgentSettingsPanel />
        <ChannelAgentActivityPanel />
      </div>
    </ChannelInspectorShell>
  );
}

function ChannelPage() {
  const currentChannel = useStore(s => s.currentChannel);

  return (
    <div className="channel-page">
      <div className="channel-view active">
        {currentChannel ? (
          <>
            <ChannelHeader />
            <div className="channel-messages">
              <ChannelMessages />
            </div>
            <ChannelInputArea />
          </>
        ) : (
          <div className="channel-select-empty">
            {tr('channel.selectHint')}
          </div>
        )}
      </div>
      <ChannelInspectorPanel />
    </div>
  );
}

function PluginPage({ pluginId }: { pluginId: string }) {
  return (
    <div className="plugin-page-shell">
      <PluginPageView pluginId={pluginId} />
    </div>
  );
}

export function WorkspaceCompanionRail() {
  const jianOpen = useStore(s => s.jianOpen);

  return (
    <aside className={`jian-sidebar${jianOpen ? '' : ' collapsed'}`} id="jianSidebar">
      <div className="resize-handle resize-handle-left" id="jianResizeHandle"></div>
      <div className="jian-sidebar-inner">
        <RegionalErrorBoundary region="right-workspace">
          <RightWorkspacePanel />
        </RegionalErrorBoundary>
      </div>
    </aside>
  );
}

export function AppPages({ inputCardRef }: { inputCardRef: RefObject<HTMLDivElement | null> }) {
  const currentTab = useStore(s => s.currentTab);
  const isPluginTab = typeof currentTab === 'string' && currentTab.startsWith('plugin:');

  return (
    <>
      <MainContent>
        {currentTab === 'chat' && <ChatPage inputCardRef={inputCardRef} />}
        {currentTab === 'channels' && <ChannelPage />}
        {isPluginTab && <PluginPage pluginId={currentTab.slice(7)} />}
        <ActivityPanel />
        <AutomationPanel />
        <BridgePanel />
      </MainContent>

      {currentTab === 'chat' && <PreviewPanel />}
      <WorkspaceCompanionRail />
    </>
  );
}
