import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../store';
import { t } from '../helpers';
import { SettingsSection } from '../components/SettingsSection';
import { Toggle } from '../widgets/Toggle';
import { AgentConnectorControls } from './mcp/AgentConnectorControls';
import { ConnectorForm } from './mcp/ConnectorForm';
import { ConnectorList } from './mcp/ConnectorList';
import { connectorsFromMcpJson } from './mcp/mcp-config';
import {
  EMPTY_MCP_STATE,
  addMcpConnector,
  loadMcpState,
  logoutMcpOAuth,
  pollMcpOAuth,
  removeMcpConnector,
  runMcpConnectorAction,
  setAgentMcpConnector,
  setAgentMcpTool,
  setMcpEnabled,
  startMcpOAuth,
  updateMcpConnector,
} from './mcp/mcp-api';
import type { McpConnectorInput } from './mcp/types';
import styles from '../Settings.module.css';

const platform = window.platform;

export function McpTab() {
  const currentAgentId = useSettingsStore(s => s.currentAgentId);
  const showToast = useSettingsStore(s => s.showToast);
  const [viewAgentId, setViewAgentId] = useState<string | null>(currentAgentId);
  const viewAgentIdRef = useRef(viewAgentId);
  viewAgentIdRef.current = viewAgentId;

  const [state, setState] = useState(EMPTY_MCP_STATE);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingConnectorId, setEditingConnectorId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState('');

  useEffect(() => {
    if (!viewAgentId && currentAgentId) setViewAgentId(currentAgentId);
  }, [currentAgentId, viewAgentId]);

  const loadState = useCallback(async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) return;
    try {
      const snapshotAgentId = agentId;
      const data = await loadMcpState(agentId);
      if (viewAgentIdRef.current !== snapshotAgentId) return;
      setState(data);
    } catch (err) {
      console.error('[mcp] load failed:', err);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState, viewAgentId]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    try {
      await action();
      await loadState();
      showToast(t('settings.autoSaved'), 'success');
    } catch (err: unknown) {
      showToast(t('settings.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleGlobal = (enabled: boolean) => run('global', () => setMcpEnabled(enabled));
  const toggleGlobalFromRow = () => {
    if (busyKey === 'global') return;
    toggleGlobal(!state.enabled);
  };

  const addConnector = (input: McpConnectorInput) => run('add', () => addMcpConnector(input));
  const updateConnector = (connectorId: string, input: McpConnectorInput) =>
    run(`update-${connectorId}`, async () => {
      await updateMcpConnector(connectorId, input);
      setEditingConnectorId(null);
    });

  const importConnectors = () => run('import-json', async () => {
    const connectors = connectorsFromMcpJson(importJson);
    for (const connector of connectors) {
      await addMcpConnector(connector);
    }
    setImportJson('');
    setImportOpen(false);
  });

  const connectorAction = (connectorId: string, action: 'start' | 'stop' | 'refresh-tools') =>
    run(`${action}-${connectorId}`, () => runMcpConnectorAction(connectorId, action));

  const removeConnector = (connectorId: string) => {
    if (!confirm(t('settings.mcp.removeConfirm'))) return;
    run(`remove-${connectorId}`, () => removeMcpConnector(connectorId));
  };

  const setAgentConnector = (connectorId: string, enabled: boolean) => run(`agent-connector-${connectorId}`, async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) throw new Error('agentId is required');
    await setAgentMcpConnector(agentId, connectorId, enabled);
  });

  const setAgentTool = (connectorId: string, toolName: string, enabled: boolean) => run(`tool-${connectorId}-${toolName}`, async () => {
    const agentId = viewAgentIdRef.current;
    if (!agentId) throw new Error('agentId is required');
    await setAgentMcpTool(agentId, connectorId, toolName, enabled);
  });

  const connectOAuth = (connectorId: string) => run(`oauth-${connectorId}`, async () => {
    const { sessionId, url } = await startMcpOAuth(connectorId);
    platform?.openExternal?.(url);
    await waitForOAuth(sessionId);
  });

  const disconnectOAuth = (connectorId: string) =>
    run(`oauth-logout-${connectorId}`, () => logoutMcpOAuth(connectorId));

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="mcp">
      <SettingsSection title={t('settings.mcp.masterTitle')}>
        <div
          className={styles['skills-list-item']}
          tabIndex={busyKey === 'global' ? -1 : 0}
          onClick={toggleGlobalFromRow}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            toggleGlobalFromRow();
          }}
        >
          <div className={styles['skills-list-info']}>
            <div className={styles['skills-list-name']}>{t('settings.mcp.masterName')}</div>
            <div className={styles['skills-list-desc']}>{t('settings.mcp.masterDesc')}</div>
          </div>
          <div className={styles['skills-list-actions']}>
            <Toggle
              on={state.enabled}
              onChange={toggleGlobal}
              disabled={busyKey === 'global'}
              label={state.enabled ? t('common.on') : t('common.off')}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.mcp.connectorsTitle')} variant="flush">
        <div className={styles['pv-add-form-actions']}>
          <button
            className={styles['pv-add-form-btn']}
            type="button"
            disabled={busyKey === 'import-json'}
            onClick={() => setImportOpen(!importOpen)}
          >
            {t('settings.mcp.importJson')}
          </button>
        </div>
        {importOpen && (
          <div className={styles['pv-add-form']}>
            <div className={styles['settings-form-field']}>
              <label className={styles['settings-form-label']}>{t('settings.mcp.importJson')}</label>
              <textarea
                className={styles['settings-textarea']}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder={'{"mcpServers":{"example":{"command":"npx","args":["-y","mcp-server-example"]}}}'}
              />
              <span className={styles['settings-form-hint']}>{t('settings.mcp.importJsonHint')}</span>
            </div>
            <div className={styles['pv-add-form-actions']}>
              <button
                className={styles['pv-add-form-btn']}
                type="button"
                onClick={() => setImportOpen(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className={`${styles['pv-add-form-btn']} ${styles['primary']}`}
                type="button"
                disabled={!importJson.trim() || busyKey === 'import-json'}
                onClick={importConnectors}
              >
                {t('settings.mcp.importJson')}
              </button>
            </div>
          </div>
        )}
        <ConnectorForm
          disabled={busyKey === 'add' || (editingConnectorId ? busyKey === `update-${editingConnectorId}` : false)}
          editingConnector={state.connectors.find(connector => connector.id === editingConnectorId) || null}
          onAdd={addConnector}
          onUpdate={updateConnector}
          onCancelEdit={() => setEditingConnectorId(null)}
        />
        <ConnectorList
          connectors={state.connectors}
          globalEnabled={state.enabled}
          busyKey={busyKey}
          onAction={connectorAction}
          onEdit={setEditingConnectorId}
          onRemove={removeConnector}
          onOAuthStart={connectOAuth}
          onOAuthLogout={disconnectOAuth}
        />
      </SettingsSection>

      <AgentConnectorControls
        connectors={state.connectors}
        globalEnabled={state.enabled}
        viewAgentId={viewAgentId}
        busyKey={busyKey}
        agentConfig={state.agentConfig}
        onAgentChange={setViewAgentId}
        onConnectorToggle={setAgentConnector}
        onToolToggle={setAgentTool}
      />
    </div>
  );
}

async function waitForOAuth(sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const status = await pollMcpOAuth(sessionId);
    if (status.status === 'done') return;
    if (status.status === 'error') throw new Error(status.error || 'OAuth failed');
  }
  throw new Error('OAuth login timed out');
}
