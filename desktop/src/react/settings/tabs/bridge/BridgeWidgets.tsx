/**
 * Bridge small widgets — status indicators and owner selector
 */
import React, { useState } from 'react';
import { t } from '../../helpers';
import { SelectWidget } from '@/ui';
import styles from '../../Settings.module.css';

// ── Types ──

export interface KnownUser {
  userId: string;
  name?: string;
}

// ── BridgeStatusDot ──

export function BridgeStatusDot({ status }: { status?: string }) {
  let cls = 'bridge-status-dot';
  if (status === 'connected') cls += ' bridge-dot-ok';
  else if (status === 'error') cls += ' bridge-dot-err';
  else cls += ' bridge-dot-off';
  return <span className={cls} />;
}

// ── BridgeStatusText ──

export function BridgeStatusText({ status, error }: { status?: string; error?: string }) {
  let text = t('settings.bridge.disconnected');
  if (status === 'connected') text = t('settings.bridge.connected');
  else if (status === 'error') text = t('settings.bridge.error') + (error ? `: ${error}` : '');
  return <span className="bridge-status-text">{text}</span>;
}

// ── OwnerSelect ──

interface OwnerSelectProps {
  platform: string;
  users: KnownUser[];
  currentOwner?: string;
  onChange: (userId: string) => void;
}

export function OwnerSelect({ platform, users, currentOwner, onChange }: OwnerSelectProps) {
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const handleChange = (value: string) => {
    if (!value) {
      onChange(value);
      return;
    }
    setPendingUserId(value);
  };

  const confirm = () => {
    if (pendingUserId !== null) {
      onChange(pendingUserId);
      setPendingUserId(null);
    }
  };

  const cancel = () => setPendingUserId(null);

  return (
    <div className={`${styles['settings-form-field']} ${'bridge-owner-field'}`}>
      <label className={`${styles['settings-form-label']} ${'bridge-owner-label'}`}>{t('settings.bridge.ownerSelect')}</label>
      <p className="bridge-owner-warning">{t('settings.bridge.ownerWarning')}</p>
      <SelectWidget
        value={currentOwner || ''}
        onChange={handleChange}
        disabled={users.length === 0}
        options={[
          { value: '', label: users.length > 0 ? '—' : t('settings.bridge.ownerNone') },
          ...users.map((u) => ({ value: u.userId, label: u.name || u.userId })),
        ]}
      />

      {pendingUserId !== null && (
        <div className={`${styles['memory-confirm-overlay']} ${styles['visible']}`} onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}>
          <div className={styles['memory-confirm-card']}>
            <p className={styles['memory-confirm-text']}>
              {t('settings.bridge.ownerConfirmText')}
            </p>
            <div className={styles['memory-confirm-actions']}>
              <button className={styles['memory-confirm-cancel']} onClick={cancel}>
                {t('settings.bridge.ownerConfirmCancel')}
              </button>
              <button className={styles['memory-confirm-primary']} onClick={confirm}>
                {t('settings.bridge.ownerConfirmSave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
