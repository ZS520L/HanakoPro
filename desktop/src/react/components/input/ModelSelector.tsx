import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../../stores';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useI18n } from '../../hooks/use-i18n';
import type { Model } from '../../types';
import type { SessionModel } from '../../stores/chat-types';
import styles from './InputArea.module.css';

export function ModelSelector({ models, sessionModel, isStreaming = false }: {
  models: Model[];
  sessionModel?: SessionModel;
  isStreaming?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const matchedSessionModel = sessionModel
    ? models.find(m => m.id === sessionModel.id && m.provider === sessionModel.provider)
    : undefined;
  const current = sessionModel
    ? (matchedSessionModel ? { ...matchedSessionModel, ...sessionModel } : sessionModel)
    : models.find(m => m.isCurrent);
  const sessionModelUnavailable = !!(sessionModel?.id && sessionModel.provider && models.length > 0 && !matchedSessionModel);
  const label = (() => {
    if (loading) return '...';
    if (sessionModelUnavailable) return t('model.unavailable') || '...';
    if (current?.name) return current.name;
    if (models.length > 0) return t('model.notSelected') || t('model.unknown') || '...';
    return t('model.noneConfigured') || t('model.unknown') || '...';
  })();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const switchModel = useCallback(async (modelId: string, provider?: string) => {
    try {
      const { currentSessionPath, pendingNewSession, chatSessions, sessionModelsByPath } = useStore.getState();
      const sessionHasMessages = !!(currentSessionPath && chatSessions[currentSessionPath]?.items?.length);

      if (sessionHasMessages && currentSessionPath) {
        // Same-model guard：严格复合键比较。sm 缺 provider 时视为不可比，走 global 当前。
        const sm = sessionModelsByPath[currentSessionPath];
        const useSession = !!(sm?.id && sm?.provider);
        const cur = useSession ? sm : models.find(m => m.isCurrent);
        if (cur && modelId === cur.id && provider === cur.provider) { setOpen(false); return; }

        // Per-session switch
        setLoading(true);
        useStore.getState().setModelSwitching(true);
        const res = await hanaFetch('/api/models/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath: currentSessionPath, modelId, provider }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'switch failed');

        if (data.model) {
          useStore.getState().updateSessionModel(currentSessionPath, data.model);
        }
        if (data.thinkingLevel) {
          useStore.getState().setThinkingLevel(data.thinkingLevel);
        }

        if (data.adaptations?.length) {
          const msgs: Record<string, string> = {
            compacted: '已压缩对话历史以适配新模型',
            truncated: '早期对话已被截断以适配新模型',
          };
          const text = data.adaptations.map((a: string) => msgs[a] || a).join('；');
          useStore.getState().addToast(text, 'info');
        }

        setLoading(false);
        useStore.getState().setModelSwitching(false);
      } else {
        // New session path — existing logic unchanged
        await hanaFetch('/api/models/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId, provider }),
        });
        if (currentSessionPath && !pendingNewSession) {
          const { createNewSession } = await import('../../stores/session-actions');
          await createNewSession();
        }
        const res = await hanaFetch('/api/models');
        const data = await res.json();
        useStore.setState({ models: data.models || [] });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('cannot switch model while streaming')) {
        useStore.getState().addToast(t('model.switchWhileStreaming'), 'warning', 4000, {
          dedupeKey: 'model-switch-streaming',
        });
      } else {
        console.error('[model] switch failed:', err);
        useStore.getState().addToast(message || t('model.switchFailed'), 'error');
      }
      setLoading(false);
      useStore.getState().setModelSwitching(false);
    }
    setOpen(false);
  }, [models, t]);

  // 按 provider 分组
  const grouped = useMemo(() => {
    const groups: Record<string, typeof models> = {};
    for (const m of models) {
      const key = m.provider || '';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    // 只补入仍可用的当前模型；失效模型只作为状态展示，不塞回可选列表。
    const currentCanBeSelected = !sessionModel || !!matchedSessionModel;
    if (current && currentCanBeSelected && !sessionModelUnavailable && !models.find(m => m.id === current.id && m.provider === current.provider)) {
      const key = current.provider || '';
      if (!groups[key]) groups[key] = [];
      groups[key].unshift(current as typeof models[0]);
    }
    return groups;
  }, [models, current, sessionModel, matchedSessionModel, sessionModelUnavailable]);

  const groupKeys = Object.keys(grouped);
  const hasMultipleProviders = groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== '');

  return (
    <div className={`${styles['model-selector']}${open ? ` ${styles.open}` : ''}`} ref={ref}>
      <button
        className={`${styles['model-pill']}${loading ? ` ${styles['model-pill-disabled']}` : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (loading) return;
          if (isStreaming) {
            useStore.getState().addToast(t('model.switchWhileStreaming'), 'warning', 4000, {
              dedupeKey: 'model-switch-streaming',
            });
            return;
          }
          setOpen(!open);
        }}
      >
        <span>{label}</span>
        <span className={styles['model-arrow']}>▾</span>
      </button>
      {open && (
        <div className={styles['model-dropdown']}>
          {groupKeys.map(provider => {
            const items = grouped[provider];
            return (
              <div key={provider || '__none'}>
                {hasMultipleProviders && (
                  <div className={styles['model-group-header']}>{provider || '—'}</div>
                )}
                {items.map(m => (
                  <button
                    key={`${m.provider}/${m.id}`}
                    className={`${styles['model-option']}${(m.id === current?.id && m.provider === current?.provider) ? ` ${styles.active}` : ''}`}
                    onClick={() => switchModel(m.id, m.provider)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
