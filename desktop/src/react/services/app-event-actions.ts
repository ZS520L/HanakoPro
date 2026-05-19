import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { applyAgentIdentity, loadAgents } from '../stores/agent-actions';
import { loadSessions, switchSession } from '../stores/session-actions';
import { loadModels } from '../utils/ui-helpers';
import { activateWorkspaceDesk } from '../stores/desk-actions';
import { loadChannels } from '../stores/channel-actions';
import { applyEditorTypography } from '../editor/typography';
// @ts-expect-error — shared JS module
import { mergeWorkspaceHistory } from '../../../../shared/workspace-history.js';

declare const i18n: {
  locale: string;
  defaultName: string;
  load(locale: string): Promise<void>;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- app events cross IPC/WS boundaries */

// Race guard: rapid agent switches (A→B→C) can cause stale async responses
// from earlier switches to overwrite current state. Same pattern as
// _switchVersion in session-actions.ts.
let _agentSwitchVersion = 0;
let requestContextUsage: (sessionPath: string) => void = () => {};

export function configureAppEventActions(options: {
  requestContextUsage?: (sessionPath: string) => void;
}): void {
  requestContextUsage = options.requestContextUsage || (() => {});
}

function normalizeWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function readConfigHomeFolder(config: any): string | null {
  return normalizeWorkspacePath(config?.desk?.home_folder ?? config?.deskHome);
}

export function readConfigCwdHistory(config: any): string[] {
  const history = Array.isArray(config?.cwd_history)
    ? config.cwd_history
    : Array.isArray(config?.cwdHistory)
      ? config.cwdHistory
      : [];
  return mergeWorkspaceHistory(history, []);
}

export function readConfigMemoryMasterEnabled(config: any): boolean {
  return config?.memory?.enabled !== false;
}

function handleAgentWorkspaceChanged(data: any): void {
  const state = useStore.getState();
  if (!data?.agentId || data.agentId !== state.currentAgentId) return;

  const previousHomeFolder = state.homeFolder || null;
  const previousSelectedFolder = state.selectedFolder || null;
  const nextHomeFolder = normalizeWorkspacePath(data.homeFolder);
  const selectedFollowedDefault = !previousSelectedFolder || previousSelectedFolder === previousHomeFolder;
  const nextSelectedFolder = selectedFollowedDefault ? nextHomeFolder : previousSelectedFolder;
  const deskWasShowingDefault =
    state.pendingNewSession ||
    !state.currentSessionPath ||
    !state.deskBasePath ||
    (!!previousHomeFolder && state.deskBasePath === previousHomeFolder);

  useStore.setState({
    homeFolder: nextHomeFolder,
    selectedFolder: nextSelectedFolder,
    workspaceFolders: [],
  });

  if (deskWasShowingDefault) {
    void activateWorkspaceDesk(nextHomeFolder);
  }
}

export function handleAppEvent(type: string, data: any = {}): void {
  switch (type) {
    case 'agent-switched': {
      const myVersion = ++_agentSwitchVersion;

      applyAgentIdentity({
        agentName: data.agentName,
        agentId: data.agentId,
      });
      const homeFolder = normalizeWorkspacePath(data.homeFolder);
      const cwd = normalizeWorkspacePath(data.cwd) || homeFolder;
      useStore.setState({
        homeFolder,
        selectedFolder: homeFolder || cwd,
        workspaceFolders: Array.isArray(data.workspaceFolders)
          ? data.workspaceFolders.filter((p: unknown): p is string => typeof p === 'string' && !!p.trim())
          : [],
        ...(Array.isArray(data.cwdHistory)
          ? { cwdHistory: mergeWorkspaceHistory(data.cwdHistory, []) }
          : {}),
        ...(typeof data.memoryMasterEnabled === 'boolean'
          ? { memoryMasterEnabled: data.memoryMasterEnabled }
          : {}),
      });
      if (data.sessionPath) {
        void switchSession(data.sessionPath);
      } else {
        void activateWorkspaceDesk(cwd);
      }
      loadSessions();

      // Reset channel state for new agent
      useStore.setState({
        currentChannel: null,
        channelMessages: [],
        channelMembers: [],
        channelTotalUnread: 0,
        channelHeaderName: '',
        channelHeaderMembersText: '',
        channelInfoName: '',
        channelIsDM: false,
      });
      loadChannels();

      // Reload models and reset thinking level
      loadModels();
      useStore.setState({ thinkingLevel: 'auto' });

      // Reload automation count and clear activities
      hanaFetch('/api/desk/cron').then(r => r.json()).then((d: any) => {
        if (myVersion !== _agentSwitchVersion) return; // stale
        useStore.setState({ automationCount: d.jobs?.length || 0 });
      }).catch(() => {});
      useStore.setState({ activities: [] });
      break;
    }
    case 'locale-changed':
      i18n.load(data.locale).then(() => {
        i18n.defaultName = useStore.getState().agentName;
        useStore.setState({ locale: i18n.locale });
      });
      break;
    case 'models-changed': {
      loadModels();
      // 模型配置变更可能改变 contextWindow（用户把 1M 模型改成 256k 等），
      // 主动补发一次 context_usage 让 ContextRing 立即吃到新分母。
      const sp = useStore.getState().currentSessionPath;
      if (sp) {
        requestContextUsage(sp);
      }
      break;
    }
    case 'agent-created':
    case 'agent-deleted':
      loadAgents();
      break;
    case 'agent-updated': {
      const currentAgentId = useStore.getState().currentAgentId;
      if (data.agentId && data.agentId !== currentAgentId) {
        loadAgents();
        break;
      }
      applyAgentIdentity({
        agentName: data.agentName,
        agentId: data.agentId,
        yuan: data.yuan,
        ui: { settings: false },
      });
      break;
    }
    case 'memory-master-changed': {
      const state = useStore.getState();
      if (!data.agentId) break;
      const enabled = data.enabled !== false;
      const patch: any = {};
      if (Array.isArray(state.agents)) {
        patch.agents = state.agents.map((agent: any) =>
          agent.id === data.agentId ? { ...agent, memoryMasterEnabled: enabled } : agent,
        );
      }
      if (data.agentId === state.currentAgentId) {
        patch.memoryMasterEnabled = enabled;
      }
      if (Object.keys(patch).length) {
        useStore.setState(patch);
      }
      break;
    }
    case 'agent-workspace-changed':
      handleAgentWorkspaceChanged(data);
      break;
    case 'theme-changed':
      window.setTheme(data.theme);
      break;
    case 'font-changed':
      window.setSerifFont(data.serif);
      break;
    case 'editor-typography-changed':
      applyEditorTypography(data.editor ?? data);
      break;
    case 'paper-texture-changed':
      window.setPaperTexture(data.enabled);
      break;
    case 'leaves-overlay-changed':
      window.dispatchEvent(new CustomEvent('hana-settings', {
        detail: { type: 'leaves-overlay-changed', enabled: data.enabled },
      }));
      break;
  }
}
