import React from 'react';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';
import type { McpConnector } from './types';

interface ConnectorListProps {
  connectors: McpConnector[];
  globalEnabled: boolean;
  busyKey: string | null;
  onAction: (connectorId: string, action: 'start' | 'stop' | 'refresh-tools') => void;
  onEdit: (connectorId: string) => void;
  onRemove: (connectorId: string) => void;
  onOAuthStart: (connectorId: string) => void;
  onOAuthLogout: (connectorId: string) => void;
}

export function ConnectorList({
  connectors,
  globalEnabled,
  busyKey,
  onAction,
  onEdit,
  onRemove,
  onOAuthStart,
  onOAuthLogout,
}: ConnectorListProps) {
  if (connectors.length === 0) {
    return <p className={styles['settings-muted-note']}>{t('settings.mcp.noConnectors')}</p>;
  }

  return (
    <div className={styles['skills-list-block']}>
      {connectors.map(connector => (
        <div key={connector.id} className={`${styles['skills-list-item']} ${styles['mcp-list-item']}`}>
          <div className={styles['skills-list-info']}>
            <div className={styles['skills-list-name']}>
              {connector.name}
              <span className={styles['skills-list-name-hint']}>{statusLabel(connector)}</span>
            </div>
            <div className={styles['skills-list-desc']}>{connectorTarget(connector)}</div>
            <div className={styles['settings-muted-note']}>
              {transportLabel(connector.transport)}
              {' · '}
              {authLabel(connector)}
              {connector.autoStart && (
                <>
                  {' · '}
                  {t('settings.mcp.autoStart')}
                </>
              )}
              {recordCount(connector.env) > 0 && (
                <>
                  {' · '}
                  {recordCount(connector.env)} {t('settings.mcp.envCount')}
                </>
              )}
              {recordCount(connector.headers) > 0 && (
                <>
                  {' · '}
                  {recordCount(connector.headers)} {t('settings.mcp.headersCount')}
                </>
              )}
              {' · '}
              {connector.tools.length} {t('settings.mcp.toolsCount')}
            </div>
          </div>
          <div className={`${styles['skills-list-actions']} ${styles['mcp-list-actions']}`}>
            {connector.authType === 'oauth' && connector.authStatus !== 'connected' && (
              <button
                className={styles['pv-add-form-btn']}
                type="button"
                disabled={busyKey === `oauth-${connector.id}`}
                onClick={() => onOAuthStart(connector.id)}
              >
                {t('settings.mcp.oauthConnect')}
              </button>
            )}
            {connector.authType === 'oauth' && connector.authStatus === 'connected' && (
              <button
                className={styles['pv-add-form-btn']}
                type="button"
                disabled={busyKey === `oauth-logout-${connector.id}`}
                onClick={() => onOAuthLogout(connector.id)}
              >
                {t('settings.oauth.logout')}
              </button>
            )}
            <button
              className={styles['pv-add-form-btn']}
              type="button"
              disabled={!globalEnabled || busyKey === `start-${connector.id}` || connector.status === 'running'}
              onClick={() => onAction(connector.id, 'start')}
            >
              {t('settings.mcp.start')}
            </button>
            <button
              className={styles['pv-add-form-btn']}
              type="button"
              disabled={busyKey === `stop-${connector.id}` || connector.status !== 'running'}
              onClick={() => onAction(connector.id, 'stop')}
            >
              {t('settings.mcp.stop')}
            </button>
            <button
              className={styles['pv-add-form-btn']}
              type="button"
              disabled={busyKey === `refresh-tools-${connector.id}` || connector.status !== 'running'}
              onClick={() => onAction(connector.id, 'refresh-tools')}
            >
              {t('settings.mcp.refresh')}
            </button>
            <button
              className={styles['pv-add-form-btn']}
              type="button"
              disabled={busyKey === `remove-${connector.id}`}
              onClick={() => onEdit(connector.id)}
            >
              {t('common.edit')}
            </button>
            <button
              className={styles['pv-add-form-btn']}
              type="button"
              disabled={busyKey === `remove-${connector.id}`}
              onClick={() => onRemove(connector.id)}
            >
              {t('common.remove')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function connectorTarget(connector: McpConnector): string {
  if (connector.transport === 'stdio') {
    return [connector.command, ...(connector.args || [])].filter(Boolean).join(' ');
  }
  return connector.url || connector.id;
}

function statusLabel(connector: McpConnector): string {
  return connector.status === 'running' ? t('settings.mcp.statusRunning') : t('settings.mcp.statusStopped');
}

function transportLabel(transport: string): string {
  if (transport === 'stdio') return t('settings.mcp.modeLocal');
  if (transport === 'streamable-http') return t('settings.mcp.transportStreamable');
  if (transport === 'sse') return t('settings.mcp.transportSse');
  return t('settings.mcp.transportAuto');
}

function authLabel(connector: McpConnector): string {
  if (connector.authType === 'bearer') return t('settings.mcp.authBearer');
  if (connector.authType === 'oauth') {
    return connector.authStatus === 'connected'
      ? t('settings.mcp.oauthConnected')
      : t('settings.mcp.oauthDisconnected');
  }
  return t('settings.mcp.authNone');
}

function recordCount(record?: Record<string, string>): number {
  return record ? Object.keys(record).length : 0;
}
