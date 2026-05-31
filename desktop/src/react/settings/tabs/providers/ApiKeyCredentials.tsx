import React, { useState, useEffect, useRef } from 'react';
import { useSettingsStore, type ProviderSummary } from '../../store';
import { hanaFetch } from '../../api';
import { invalidateConfigCache } from '../../../hooks/use-config';
import { t, API_FORMAT_OPTIONS } from '../../helpers';
import { SelectWidget } from '@/ui';
import { KeyInput } from '../../widgets/KeyInput';
import { Toggle } from '../../widgets/Toggle';
import { getApiKeySavePlan } from './api-key-save-plan';
import styles from '../../Settings.module.css';

export function ApiKeyCredentials({ providerId, summary, providerConfig, isPresetSetup, presetInfo, onRefresh }: {
  providerId: string;
  summary: ProviderSummary;
  providerConfig?: Record<string, unknown>;
  isPresetSetup?: boolean;
  presetInfo?: { label: string; value: string; url?: string; api?: string; local?: boolean };
  onRefresh: () => Promise<void>;
}) {
  const showToast = useSettingsStore(s => s.showToast);
  const [keyVal, setKeyVal] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const derivedBaseUrl = summary.base_url || presetInfo?.url || '';
  const [urlVal, setUrlVal] = useState(derivedBaseUrl);
  const [urlEdited, setUrlEdited] = useState(false);
  const api = summary.api || presetInfo?.api || '';
  const isDeepSeek = providerId === 'deepseek';
  const deepseekBetaStrictTools = summary.deepseek_beta_strict_tools === true
    || providerConfig?.deepseek_beta_strict_tools === true;

  // 未编辑时，从 summary 同步已保存的 key 到输入框
  useEffect(() => {
    if (!keyEdited) {
      setKeyVal(summary.api_key || '');
    }
  }, [summary.api_key, keyEdited]);

  // 未编辑时，从 summary 同步 base_url
  useEffect(() => {
    if (!urlEdited) setUrlVal(derivedBaseUrl);
  }, [derivedBaseUrl, urlEdited]);

  const verifyAndSave = async (btn: HTMLButtonElement) => {
    const plan = getApiKeySavePlan({
      keyEdited,
      keyVal,
      urlEdited,
      urlVal,
      derivedBaseUrl,
      isPresetSetup: !!isPresetSetup,
      isLocalPreset: !!presetInfo?.local,
      seedDefaultModels: !!presetInfo && (summary.models?.length ?? 0) === 0,
      api,
    });
    if (!plan.shouldSave) return;
    setConnHint(null);
    btn.classList.add(styles['spinning']);
    try {
      if (plan.shouldVerify) {
        const testRes = await hanaFetch('/api/providers/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: providerId, base_url: plan.effectiveUrl, api: plan.api, api_key: plan.key }),
        });
        const testData = await testRes.json();
        if (!testData.ok) {
          setConnStatus('fail');
          showConnHint(t('settings.providers.verifyFailed'), false);
          showToast(t('settings.providers.verifyFailed'), 'error');
          return;
        }
        setConnStatus('ok');
        showConnHint(t('settings.providers.verifyAndSaved'), true);
      }
      await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: plan.payload } }),
      });
      invalidateConfigCache();
      showToast(plan.shouldVerify ? t('settings.providers.verifySuccess') : t('settings.saved'), 'success');
      if (isPresetSetup) useSettingsStore.setState({ selectedProviderId: providerId });
      setKeyEdited(false);
      if (urlEdited) setUrlEdited(false);
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      btn.classList.remove(styles['spinning']);
    }
  };

  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const saveDeepSeekBetaStrictTools = async (on: boolean) => {
    try {
      await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: { deepseek_beta_strict_tools: on } } }),
      });
      invalidateConfigCache();
      showToast(t('settings.saved'), 'success');
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const [connHint, setConnHint] = useState<{ msg: string; ok: boolean } | null>(null);
  const connHintTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showConnHint = (msg: string, ok: boolean) => {
    if (connHintTimer.current) clearTimeout(connHintTimer.current);
    setConnHint({ msg, ok });
    connHintTimer.current = setTimeout(() => setConnHint(null), 4000);
  };

  const verifyOnly = async (btn: HTMLButtonElement) => {
    setConnStatus('testing');
    setConnHint(null);
    btn.classList.add(styles['spinning']);
    try {
      const testRes = await hanaFetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: providerId, base_url: urlVal.trim() || derivedBaseUrl, api, api_key: keyVal.trim() || undefined }),
      });
      const testData = await testRes.json();
      setConnStatus(testData.ok ? 'ok' : 'fail');
      showConnHint(testData.ok ? t('settings.providers.verifySuccess') : t('settings.providers.verifyFailed'), testData.ok);
      showToast(testData.ok ? t('settings.providers.verifySuccess') : t('settings.providers.verifyFailed'), testData.ok ? 'success' : 'error');
    } catch {
      setConnStatus('fail');
      showConnHint(t('settings.providers.verifyFailed'), false);
      showToast(t('settings.providers.verifyFailed'), 'error');
    } finally {
      btn.classList.remove(styles['spinning']);
    }
  };

  return (
    <div className={styles['pv-credentials']}>
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>{t('settings.api.apiKey')}</span>
        <div className={styles['pv-cred-key-row']}>
          <KeyInput
            value={keyVal}
            onChange={(v) => { setKeyVal(v); setKeyEdited(true); setConnStatus('idle'); setConnHint(null); }}
            placeholder={isPresetSetup ? t('settings.providers.setupHint') : ''}
          />
          <button
            className={`${styles['pv-cred-conn-icon']} ${styles[connStatus] || ''}`}
            title={t('settings.providers.verifyConnection')}
            onClick={(e) => {
              if (keyEdited && (keyVal.trim() || presetInfo?.local)) {
                verifyAndSave(e.currentTarget);
              } else {
                verifyOnly(e.currentTarget);
              }
            }}
          >
            {connStatus === 'ok' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : connStatus === 'fail' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {connHint && (
        <div className={`${styles['pv-conn-hint']} ${connHint.ok ? styles['ok'] : styles['fail']}`}>
          {connHint.ok ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
          )}
          <span>{connHint.msg}</span>
        </div>
      )}
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>Base URL</span>
        <div className={styles['pv-cred-url-row']}>
          <input
            className={styles['settings-input']}
            type="text"
            value={urlVal}
            onChange={(e) => { setUrlVal(e.target.value); setUrlEdited(true); }}
            onBlur={async () => {
              if (!urlEdited || isPresetSetup) return;
              const trimmed = urlVal.trim();
              if (trimmed === derivedBaseUrl) { setUrlEdited(false); return; }
              try {
                await hanaFetch('/api/config', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ providers: { [providerId]: { base_url: trimmed } } }),
                });
                invalidateConfigCache();
                showToast(t('settings.saved'), 'success');
                setUrlEdited(false);
                await onRefresh();
              } catch { /* swallow */ }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="https://api.example.com/v1"
            readOnly={!!isPresetSetup}
          />
        </div>
      </div>
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>{t('settings.providers.apiType')}</span>
        <div className={styles['pv-cred-select-wrapper']}>
          <SelectWidget
            className={styles['pv-cred-select']}
            options={API_FORMAT_OPTIONS}
            value={api || ''}
            onChange={async (val) => {
              if (isPresetSetup) return;
              try {
                await hanaFetch('/api/config', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ providers: { [providerId]: { api: val } } }),
                });
                invalidateConfigCache();
                showToast(t('settings.saved'), 'success');
                await onRefresh();
              } catch { /* swallow */ }
            }}
            placeholder="API Format"
            disabled={!!isPresetSetup}
          />
        </div>
      </div>
      {isDeepSeek && (
        <div className={styles['pv-cred-row']}>
          <span className={styles['pv-cred-label']}>{t('settings.providers.deepseekBeta')}</span>
          <div className={styles['pv-cred-select-wrapper']} title={t('settings.providers.deepseekBetaStrictToolsHint')}>
            <Toggle
              on={deepseekBetaStrictTools}
              onChange={saveDeepSeekBetaStrictTools}
              label={t('settings.providers.deepseekBetaStrictTools')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
