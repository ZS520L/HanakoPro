import React, { useState } from 'react';
import { useSettingsStore } from '../../store';
import { hanaFetch } from '../../api';
import { t, API_FORMAT_OPTIONS } from '../../helpers';
import { loadSettingsConfig } from '../../actions';
import { SelectWidget } from '@/ui';
import { KeyInput } from '../../widgets/KeyInput';
import styles from '../../Settings.module.css';

export function AddCustomButton({ onClick }: { onClick: () => void }) {
  return (
    <div className={styles['pv-add-wrapper']}>
      <button className={styles['pv-add-btn']} onClick={onClick}>
        + {t('settings.providers.addCustom')}
      </button>
    </div>
  );
}

export function AddProviderOverlay({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  return (
    <div className={styles['pv-add-overlay']}>
      <div className={styles['pv-add-overlay-header']}>
        <button className={styles['pv-add-overlay-back']} onClick={onCancel} aria-label={t('settings.api.cancel')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{t('settings.api.cancel')}</span>
        </button>
        <div className={styles['pv-add-overlay-title']}>{t('settings.providers.addCustom')}</div>
      </div>
      <div className={styles['pv-add-overlay-body']}>
        <AddProviderForm onDone={onDone} />
      </div>
    </div>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const showToast = useSettingsStore(s => s.showToast);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [api, setApi] = useState('openai-completions');

  const submit = async () => {
    const n = name.trim().toLowerCase();
    const u = url.trim();
    if (!n) { showToast(t('settings.providers.nameRequired'), 'error'); return; }
    if (!u) { showToast(t('settings.providers.urlRequired'), 'error'); return; }
    try {
      const res = await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [n]: { base_url: u, api_key: apiKey.trim(), api, models: [] as string[] } } }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.providers.added', { name: n }), 'success');
      await loadSettingsConfig();
      useSettingsStore.setState({ selectedProviderId: n });
      onDone();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  return (
    <div className={styles['pv-add-form']}>
      <div className={styles['pv-add-form-field']}>
        <label className={styles['pv-add-form-label']}>{t('settings.providers.customName')}</label>
        <input className={styles['settings-input']} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-provider" />
      </div>
      <div className={styles['pv-add-form-field']}>
        <label className={styles['pv-add-form-label']}>Base URL</label>
        <input className={styles['settings-input']} type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1" />
      </div>
      <div className={styles['pv-add-form-field']}>
        <label className={styles['pv-add-form-label']}>{t('settings.api.apiKey')}</label>
        <KeyInput value={apiKey} onChange={setApiKey} placeholder={t('settings.api.apiKeyPlaceholder')} />
      </div>
      <div className={styles['pv-add-form-field']}>
        <label className={styles['pv-add-form-label']}>{t('settings.providers.apiFormat')}</label>
        <SelectWidget options={API_FORMAT_OPTIONS} value={api} onChange={setApi} placeholder="API Format" />
      </div>
      <div className={styles['pv-add-form-actions']}>
        <button className={`${styles['pv-add-form-btn']} ${styles['primary']}`} onClick={submit}>{t('settings.providers.addBtn')}</button>
      </div>
    </div>
  );
}
