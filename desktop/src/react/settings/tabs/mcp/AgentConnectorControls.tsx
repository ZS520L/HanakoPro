import React from 'react';
import { AgentSelect } from '../bridge/AgentSelect';
import { SettingsSection } from '../../components/SettingsSection';
import { Toggle } from '../../widgets/Toggle';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';
import type { McpAgentConnectorConfig, McpConnector } from './types';

interface AgentConnectorControlsProps {
  connectors: McpConnector[];
  globalEnabled: boolean;
  viewAgentId: string | null;
  busyKey: string | null;
  agentConfig: {
    connectors?: Record<string, McpAgentConnectorConfig>;
    servers?: Record<string, McpAgentConnectorConfig>;
  };
  onAgentChange: (agentId: string | null) => void;
  onConnectorToggle: (connectorId: string, enabled: boolean) => void;
  onToolToggle: (connectorId: string, toolName: string, enabled: boolean) => void;
}

export function AgentConnectorControls({
  connectors,
  globalEnabled,
  viewAgentId,
  busyKey,
  agentConfig,
  onAgentChange,
  onConnectorToggle,
  onToolToggle,
}: AgentConnectorControlsProps) {
  const connectorConfig = (connectorId: string) =>
    agentConfig.connectors?.[connectorId] || agentConfig.servers?.[connectorId] || {};
  const isConnectorEnabled = (connectorId: string) => connectorConfig(connectorId).enabled === true;
  const isToolEnabled = (connectorId: string, toolName: string) =>
    connectorConfig(connectorId).tools?.[toolName] === true;

  return (
    <SettingsSection
      title={t('settings.mcp.agentTitle')}
      context={<AgentSelect value={viewAgentId} onChange={onAgentChange} />}
    >
      {connectors.length === 0 ? (
        <p className={`${styles['agent-skill-empty']} ${styles['mcp-empty-state']}`}>
          {t('settings.mcp.noConnectors')}
        </p>
      ) : (
        connectors.map(connector => (
          <div key={connector.id}>
            <div className={styles['skills-list-item']}>
              <div className={styles['skills-list-info']}>
                <div className={styles['skills-list-name']}>{connector.name}</div>
                <div className={styles['skills-list-desc']}>{t('settings.mcp.agentConnectorDesc')}</div>
              </div>
              <div className={styles['skills-list-actions']}>
                <Toggle
                  on={isConnectorEnabled(connector.id)}
                  onChange={(enabled) => onConnectorToggle(connector.id, enabled)}
                  disabled={!globalEnabled || busyKey === `agent-connector-${connector.id}`}
                  label={isConnectorEnabled(connector.id) ? t('common.on') : t('common.off')}
                />
              </div>
            </div>
            {connector.tools.map(tool => (
              <div key={`${connector.id}:${tool.name}`} className={styles['skills-list-item']}>
                <div className={styles['skills-list-info']}>
                  <div className={styles['skills-list-name']}>{tool.title || tool.name}</div>
                  <div className={styles['skills-list-desc']}>{tool.description || tool.name}</div>
                </div>
                <div className={styles['skills-list-actions']}>
                  <Toggle
                    on={isToolEnabled(connector.id, tool.name)}
                    onChange={(enabled) => onToolToggle(connector.id, tool.name, enabled)}
                    disabled={!globalEnabled || !isConnectorEnabled(connector.id) || busyKey === `tool-${connector.id}-${tool.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </SettingsSection>
  );
}
