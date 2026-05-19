import React, { useState, useCallback, useEffect } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { MediaProviderDetail } from './media/MediaProviderDetail';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { SelectWidget } from '@/ui';
import styles from '../Settings.module.css';

interface MediaProvider {
  providerId: string;
  displayName?: string;
  hasCredentials: boolean;
  unavailableReason?: string | null;
  models: { id: string; name: string }[];
  availableModels: { id: string; name: string }[];
}

interface MediaConfig {
  defaultImageModel?: { id: string; provider: string };
  providerDefaults?: Record<string, any>;
}

function encodeConfigPatch(updates: Partial<MediaConfig>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(updates).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

function applyConfigPatch(prev: MediaConfig, updates: Partial<MediaConfig>): MediaConfig {
  const next: MediaConfig = { ...prev };
  for (const [key, value] of Object.entries(updates) as Array<[keyof MediaConfig, MediaConfig[keyof MediaConfig]]>) {
    if (value === undefined) delete next[key];
    else next[key] = value as any;
  }
  return next;
}

export function MediaTab() {
  const [providers, setProviders] = useState<Record<string, MediaProvider>>({});
  const [config, setConfig] = useState<MediaConfig>({});
  const [selected, setSelected] = useState<string | null>(null);
  const showToast = useSettingsStore(s => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await hanaFetch('/api/plugins/image-gen/providers');
      const data = await res.json();
      const nextProviders = data.providers || {};
      setProviders(nextProviders);
      setConfig(data.config || {});
      setSelected(current => {
        if (current && nextProviders[current]) return current;
        const ids = Object.keys(nextProviders);
        return ids.find(id => nextProviders[id]?.hasCredentials) || ids[0] || null;
      });
    } catch { /* plugin not loaded yet */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providerIds = Object.keys(providers);
  const allImageModels = providerIds.flatMap(pid =>
    (providers[pid].models || []).map(m => ({ ...m, provider: pid }))
  );

  const saveConfig = async (updates: Partial<MediaConfig>) => {
    try {
      const res = await hanaFetch('/api/plugins/image-gen/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: encodeConfigPatch(updates) }),
      });
      const data = await res.json().catch(() => null);
      if (data?.values) setConfig(data.values);
      else setConfig(prev => applyConfigPatch(prev, updates));
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error');
    }
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="media">
      {/* pv-layout：double-column variant 做外壳，内部 DOM 保留原样 */}
      <SettingsSection variant="double-column">
        <div className={styles['pv-layout']}>
          {/* Left: Provider list */}
          <div className={styles['pv-list']}>
            <div className={styles['pv-list-group-label']}>{t('settings.media.imageGeneration')}</div>
            {providerIds.map(pid => {
              const p = providers[pid];
              return (
                <button
                  key={pid}
                  className={`${styles['pv-list-item']}${selected === pid ? ' ' + styles['selected'] : ''}${!p.hasCredentials ? ' ' + styles['dim'] : ''}`}
                  onClick={() => setSelected(pid)}
                >
                  <span className={`${styles['pv-status-dot']}${p.hasCredentials ? ' ' + styles['on'] : ''}`} />
                  <span className={styles['pv-list-item-name']}>{p.displayName || pid}</span>
                  <span className={styles['pv-list-item-count']}>{p.models.length}</span>
                </button>
              );
            })}

            {/* Placeholder sections for future capabilities */}
            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']} style={{ color: 'var(--text-muted)' }}>
              {t('settings.media.speechRecognition')}
            </div>
            <div className={styles['pv-list-item']} style={{ opacity: 0.3, pointerEvents: 'none' }}>
              <span className={styles['pv-status-dot']} />
              <span className={styles['pv-list-item-name']} style={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
                {t('settings.media.comingSoon')}
              </span>
            </div>

            <div className={styles['pv-list-divider']} />
            <div className={styles['pv-list-group-label']} style={{ color: 'var(--text-muted)' }}>
              {t('settings.media.speechSynthesis')}
            </div>
            <div className={styles['pv-list-item']} style={{ opacity: 0.3, pointerEvents: 'none' }}>
              <span className={styles['pv-status-dot']} />
              <span className={styles['pv-list-item-name']} style={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
                {t('settings.media.comingSoon')}
              </span>
            </div>
          </div>

          {/* Right: Provider detail */}
          <div className={styles['pv-detail']}>
            {selected && providers[selected] ? (
              <MediaProviderDetail
                providerId={selected}
                provider={providers[selected]}
                config={config}
                onSaveConfig={saveConfig}
                onRefresh={load}
              />
            ) : (
              <div className={styles['pv-empty']}>
                {t('settings.media.noProvider')}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* 全局默认：标准 inline row */}
      <SettingsSection title={t('settings.media.globalDefault')}>
        <SettingsRow
          label={t('settings.media.defaultModel')}
          control={
            <SelectWidget
              value={config.defaultImageModel ? `${config.defaultImageModel.provider}/${config.defaultImageModel.id}` : ''}
              onChange={(val) => {
                if (!val) {
                  saveConfig({ defaultImageModel: undefined });
                  return;
                }
                const [provider, ...rest] = val.split('/');
                saveConfig({ defaultImageModel: { id: rest.join('/'), provider } });
              }}
              options={[
                { value: '', label: '—' },
                ...allImageModels.map(m => {
                  const providerHasCredentials = providers[m.provider]?.hasCredentials === true;
                  const label = `${m.provider} / ${m.name || m.id}`;
                  return {
                    value: `${m.provider}/${m.id}`,
                    label: providerHasCredentials ? label : `${label} (${t('settings.media.credentialMissing')})`,
                    disabled: !providerHasCredentials,
                  };
                }),
              ]}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
