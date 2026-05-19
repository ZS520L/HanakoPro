/**
 * WelcomeScreen — 欢迎页 React 组件
 *
 * Phase 6C: 替代 app-agents-shim.ts 中的 renderWelcomeAgentSelector / updateWelcomeForAgent
 * 以及 bridge.ts desk shim 中的 folder picker / memory toggle。
 * 通过 portal 渲染到 #welcome，从 Zustand 状态驱动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useI18n } from '../hooks/use-i18n';
import { loadModels } from '../utils/ui-helpers';
import { addWorkspaceFolder, applyFolder, removeWorkspaceFolder } from '../stores/desk-actions';
import { openSettingsModal } from '../stores/settings-modal-actions';
import type { Agent } from '../types';
import { AgentAvatar, refreshAgentAvatarVersion, resolveAgentDisplayInfo, type AgentDisplayInfo } from '../utils/agent-display';
import styles from './Welcome.module.css';
// @ts-expect-error — shared JS module
import { buildWorkspacePickerItems } from '../../../../shared/workspace-history.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- store setState 回调 (s: any) */

export function refreshAvatarTs() { refreshAgentAvatarVersion(); }

// ── 主组件 ──

export function WelcomeScreen() {
  return <WelcomeInner />;
}

// ── Yuan helpers ──

function randomWelcome(agentName: string, yuan: string): string {
  const t = window.t ?? ((p: string) => p);
  const yuanMsgs = t(`yuan.welcome.${yuan}`);
  const msgs = Array.isArray(yuanMsgs) ? yuanMsgs : t('welcome.messages');
  if (!Array.isArray(msgs) || msgs.length === 0) return '';
  const raw = msgs[Math.floor(Math.random() * msgs.length)];
  return raw.replaceAll('{name}', agentName);
}

// ── 内部组件 ──

function WelcomeInner() {
  const { t } = useI18n();
  const welcomeVisible = useStore(s => s.welcomeVisible);
  const agents = useStore(s => s.agents);
  const agentName = useStore(s => s.agentName);
  const agentAvatarUrl = useStore(s => s.agentAvatarUrl);
  const agentYuan = useStore(s => s.agentYuan);
  const currentAgentId = useStore(s => s.currentAgentId);
  const selectedAgentId = useStore(s => s.selectedAgentId);
  const memoryEnabled = useStore(s => s.memoryEnabled);
  const activeMemoryMasterEnabled = useStore(s => s.memoryMasterEnabled);
  const selectedFolder = useStore(s => s.selectedFolder);
  const homeFolder = useStore(s => s.homeFolder);
  const workspaceFolders = useStore(s => s.workspaceFolders);
  const cwdHistory = useStore(s => s.cwdHistory);

  // Determine the displayed agent
  const displayAgent = useMemo(() => {
    const sel = selectedAgentId || currentAgentId;
    return agents.find(a => a.id === sel) || null;
  }, [agents, selectedAgentId, currentAgentId]);

  const displayInfo = resolveAgentDisplayInfo({
    id: displayAgent?.id || selectedAgentId || currentAgentId,
    agents,
    fallbackAgentName: agentName,
    fallbackAgentYuan: agentYuan,
    fallbackAgentAvatarUrl: agentAvatarUrl,
  });
  const displayName = displayInfo.displayName;
  const displayYuan = displayInfo.yuan || agentYuan;
  const memoryMasterEnabled = displayAgent?.memoryMasterEnabled ?? activeMemoryMasterEnabled;

  // Greeting text — regenerate when agent changes or welcome becomes visible
  const [greeting, setGreeting] = useState('');
  const prevAgentRef = useRef<string | null>(null);

  useEffect(() => {
    const agentKey = displayAgent?.id || currentAgentId;
    if (welcomeVisible && (prevAgentRef.current !== agentKey || !greeting)) {
      setGreeting(randomWelcome(displayName, displayYuan));
      prevAgentRef.current = agentKey ?? null;
    }
  }, [welcomeVisible, displayAgent?.id, currentAgentId, displayName, displayYuan, greeting]);

  // Re-randomize greeting when welcome becomes visible again
  useEffect(() => {
    if (welcomeVisible) {
      setGreeting(randomWelcome(displayName, displayYuan));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 welcomeVisible 切换时重新随机，不跟踪 displayName/displayYuan 变化
  }, [welcomeVisible]);

  if (!welcomeVisible) return null;

  return (
    <div className={styles.welcome}>
      <WelcomeAvatar info={displayInfo} />
      <p className={styles.welcomeText}>{greeting}</p>
      {agents.length >= 2 && (
        <AgentChips
          agents={agents}
          selectedId={selectedAgentId || currentAgentId}
        />
      )}
      <FolderPicker
        selectedFolder={selectedFolder}
        homeFolder={homeFolder}
        workspaceFolders={workspaceFolders}
        cwdHistory={cwdHistory}
      />
      <MemoryToggle enabled={memoryEnabled} masterEnabled={memoryMasterEnabled} t={t} />
    </div>
  );
}

// ── Welcome Avatar ──

function WelcomeAvatar({ info }: {
  info: AgentDisplayInfo;
}) {
  const handleClick = useCallback(() => {
    openSettingsModal('agent');
  }, []);

  return (
    <AgentAvatar
      info={info}
      className={styles.welcomeAvatar}
      alt={info.displayName}
      onClick={handleClick}
    />
  );
}

// ── Agent Chips ──

function AgentChips({ agents, selectedId }: {
  agents: Agent[];
  selectedId: string | null;
}) {
  const handleClick = useCallback((agentId: string) => {
    useStore.setState({ selectedAgentId: agentId });
    // 切换到该 agent 的 chat model
    const agent = agents.find(a => a.id === agentId) as any;
    if (agent?.chatModel?.id) {
      hanaFetch('/api/models/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: agent.chatModel.id, provider: agent.chatModel.provider }),
      }).then(() => loadModels()).catch(() => {});
    }
  }, [agents]);

  return (
    <div className={styles.welcomeAgentSelector}>
      {agents.map(agent => (
        <AgentChip
          key={agent.id}
          agent={agent}
          isSelected={agent.id === selectedId}
          onClick={handleClick}
        />
      ))}
    </div>
  );
}

function AgentChip({ agent, isSelected, onClick }: {
  agent: Agent;
  isSelected: boolean;
  onClick: (id: string) => void;
}) {
  const handleClick = useCallback(() => {
    onClick(agent.id);
  }, [agent.id, onClick]);
  const info = resolveAgentDisplayInfo({
    id: agent.id,
    agents: [agent],
    fallbackAgentName: agent.name,
    fallbackAgentYuan: agent.yuan,
  });

  return (
    <button
      className={`${styles.welcomeAgentChip}${isSelected ? ` ${styles.welcomeAgentChipSelected}` : ''}`}
      onClick={handleClick}
    >
      <AgentAvatar
        info={info}
        className={styles.welcomeAgentChipAvatar}
      />
      <span>{agent.name}</span>
    </button>
  );
}

// ── Folder Picker ──

function FolderPicker({ selectedFolder, homeFolder, workspaceFolders, cwdHistory }: {
  selectedFolder: string | null;
  homeFolder: string | null;
  workspaceFolders: string[];
  cwdHistory: string[];
}) {
  const { t } = useI18n();
  const [showHistory, setShowHistory] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showHistory) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('click', close, true), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close, true);
    };
  }, [showHistory]);

  const handleBrowse = useCallback(async () => {
    setShowHistory(false);
    const folder = await window.platform?.selectFolder?.();
    if (!folder) return;
    applyFolder(folder);
  }, []);

  const handleAddWorkspaceFolder = useCallback(async () => {
    const folder = await window.platform?.selectFolder?.();
    if (!folder) return;
    addWorkspaceFolder(folder);
  }, []);

  const handleButtonClick = useCallback(() => {
    if (selectedFolder || cwdHistory.length > 0 || workspaceFolders.length > 0) {
      setShowHistory(prev => !prev);
    } else {
      handleBrowse();
    }
  }, [cwdHistory.length, handleBrowse, selectedFolder, workspaceFolders.length]);

  const handleSelectHistory = useCallback((folder: string) => {
    setShowHistory(false);
    applyFolder(folder);
  }, []);

  const folderName = selectedFolder ? selectedFolder.split('/').pop() || selectedFolder : null;
  const label = folderName
    ? `${t('input.workspace')}${folderName}`
    : t('input.selectWorkspace');

  return (
    <div
      className={`${styles.folderSelectWrap}${showHistory ? ` ${styles.folderSelectWrapShowHistory}` : ''}`}
      ref={wrapRef}
    >
      <button
        className={`${styles.folderSelectBtn}${selectedFolder ? ` ${styles.folderSelectBtnHasFolder}` : ''}`}
        onClick={handleButtonClick}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>{label}</span>
        <svg className={styles.folderSwapIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
        </svg>
      </button>
      {showHistory && (
        <FolderHistory
          cwdHistory={cwdHistory}
          selectedFolder={selectedFolder}
          homeFolder={homeFolder}
          workspaceFolders={workspaceFolders}
          onSelect={handleSelectHistory}
          onBrowse={handleBrowse}
          onAddWorkspaceFolder={handleAddWorkspaceFolder}
          onRemoveWorkspaceFolder={removeWorkspaceFolder}
        />
      )}
    </div>
  );
}

function FolderHistory({ cwdHistory, selectedFolder, homeFolder, workspaceFolders, onSelect, onBrowse, onAddWorkspaceFolder, onRemoveWorkspaceFolder }: {
  cwdHistory: string[];
  selectedFolder: string | null;
  homeFolder: string | null;
  workspaceFolders: string[];
  onSelect: (folder: string) => void;
  onBrowse: () => void;
  onAddWorkspaceFolder: () => void;
  onRemoveWorkspaceFolder: (folder: string) => void;
}) {
  const primaryItems: string[] = buildWorkspacePickerItems({ selectedFolder, homeFolder, cwdHistory });
  const t = window.t ?? ((p: string) => p);
  return (
    <div className={styles.folderHistory}>
      <div className={styles.folderHistorySectionLabel}>
        {t('input.currentWorkspace')}
      </div>
      {primaryItems.map(p => {
        const name = p.split('/').pop() || p;
        const isActive = p === selectedFolder;
        return (
          <div
            key={p}
            className={`${styles.folderHistoryItem}${isActive ? ` ${styles.folderHistoryItemActive}` : ''}`}
            title={p}
            onClick={(e) => { e.stopPropagation(); onSelect(p); }}
          >
            <span className={styles.folderHistoryItemIcon}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </span>
            <span className={styles.folderHistoryItemName}>{name}</span>
          </div>
        );
      })}
      <div className={styles.folderHistoryDivider} />
      <div className={styles.folderHistoryBrowse} onClick={(e) => { e.stopPropagation(); onBrowse(); }}>
        <span className={styles.folderHistoryItemIcon}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
          </svg>
        </span>
        <span>{t('input.selectOtherFolder')}</span>
      </div>
      <div className={styles.folderHistoryDivider} />
      <div className={styles.folderHistorySectionLabel}>
        {t('input.extraFolders')}
      </div>
      {workspaceFolders.map(p => {
        const name = p.split('/').pop() || p;
        return (
          <div
            key={p}
            className={styles.folderHistoryItem}
            title={p}
            onClick={(e) => { e.stopPropagation(); }}
          >
            <span className={styles.folderHistoryItemIcon}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </span>
            <span className={styles.folderHistoryItemName}>{name}</span>
            <button
              type="button"
              className={styles.folderHistoryRemove}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveWorkspaceFolder(p);
              }}
              title={(window.t ?? ((key: string) => key))('common.remove')}
            >
              x
            </button>
          </div>
        );
      })}
      <div className={styles.folderHistoryBrowse} onClick={(e) => { e.stopPropagation(); onAddWorkspaceFolder(); }}>
        <span className={styles.folderHistoryItemIcon}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </span>
        <span>{t('input.addExternalFolder')}</span>
      </div>
    </div>
  );
}

// ── Memory Toggle ──

function MemoryToggle({ enabled, masterEnabled, t }: {
  enabled: boolean;
  masterEnabled: boolean;
  t: (key: string) => string;
}) {
  const handleClick = useCallback(() => {
    useStore.setState((s) => ({ memoryEnabled: !s.memoryEnabled }));
  }, []);
  const disabled = !masterEnabled;
  const label = disabled ? t('welcome.memoryDisabled') : t(enabled ? 'welcome.memoryOn' : 'welcome.memoryOff');

  return (
    <button
      className={`${styles.memoryToggleBtn}${enabled && !disabled ? ` ${styles.memoryToggleBtnActive}` : ''}${disabled ? ` ${styles.memoryToggleBtnDisabled}` : ''}`}
      onClick={handleClick}
      disabled={disabled}
      title={disabled ? t('welcome.memoryDisabled') : undefined}
    >
      <svg className={styles.memoryToggleIcon} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
