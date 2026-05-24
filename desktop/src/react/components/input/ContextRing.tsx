import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../stores';
import { useI18n } from '../../hooks/use-i18n';
import { shouldShowContextRingTokenLabel } from './context-ring-visibility';
import { compressForkSession } from '../../stores/session-actions';
import styles from './InputArea.module.css';

export function ContextRing() {
  const { t } = useI18n();
  const agentYuan = useStore(s => s.agentYuan);
  const [tokens, setTokens] = useState<number | null>(null);
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [hovered, setHovered] = useState(false);

  // 从 Zustand store 同步 context 数据（keyed store 优先，compat global 兜底）
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const contextEntry = useStore(s => s.contextBySession[s.currentSessionPath || '']);
  const globalContextTokens = useStore(s => s.contextTokens);
  const globalContextWindow = useStore(s => s.contextWindow);
  const globalContextPercent = useStore(s => s.contextPercent);
  const storeContextTokens = contextEntry?.tokens ?? globalContextTokens;
  const storeContextWindow = contextEntry?.window ?? globalContextWindow;
  const storeContextPercent = contextEntry?.percent ?? globalContextPercent;
  const storeCompacting = useStore(s => currentSessionPath ? s.compactingSessions.includes(currentSessionPath) : false);
  const forking = useStore(s => currentSessionPath ? s.compressForkingSessions.includes(currentSessionPath) : false);

  useEffect(() => {
    setTokens(storeContextTokens ?? null);
    setContextWindow(storeContextWindow ?? null);
    setPercent(storeContextPercent ?? null);
    setCompacting(storeCompacting);
  }, [storeContextTokens, storeContextWindow, storeContextPercent, storeCompacting]);

  if (!currentSessionPath) return null;
  const displayTokens = tokens ?? 0;
  const pct = percent ?? 0;
  const showTokenLabel = shouldShowContextRingTokenLabel(tokens);

  // SVG 圆环参数（更小更粗）
  const r = 6;
  const sw = 2.5;
  const size = (r + sw) * 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference * (1 - Math.min(pct, 100) / 100);
  const yuan = agentYuan || 'hanako';

  // token 数量格式化
  const tokensK = displayTokens > 0 && displayTokens < 1000 ? '<1' : Math.round(displayTokens / 1000);
  const windowK = contextWindow != null ? Math.round(contextWindow / 1000) : 0;
  const pctLabel = pct > 0 && pct < 1 ? '<1' : Math.round(pct);

  return (
    <span className={styles['context-ring-wrap']}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`${styles['context-ring']}${compacting ? ` ${styles.compacting}` : ''}${forking ? ` ${styles.forking}` : ''}`}
        data-yuan={yuan}
        disabled={compacting || forking}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={center} cy={center} r={r} fill="none" stroke="var(--ring-bg)" strokeWidth={sw} />
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke="var(--ring-fg)"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform={`rotate(-90 ${center} ${center})`}
            className={styles['context-ring-progress']}
          />
        </svg>
        {showTokenLabel && (
          <span className={styles['context-ring-label']}>{tokensK}k</span>
        )}
      </button>
      {hovered && (
        <div className={styles['context-ring-tooltip']}>
          <div>{t('input.contextWindow', { windowK })}</div>
          {tokens != null && (
            <div>{t('input.tokensUsed', { tokensK, pct: pctLabel })}</div>
          )}
        </div>
      )}
    </span>
  );
}

export function ContextCompressButton() {
  const { t } = useI18n();
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const contextEntry = useStore(s => s.contextBySession[s.currentSessionPath || '']);
  const compressionAvailable = contextEntry?.compressionAvailable ?? false;
  const forking = useStore(s => currentSessionPath ? s.compressForkingSessions.includes(currentSessionPath) : false);

  const handleCompressFork = useCallback(async () => {
    if (forking || !currentSessionPath) return;
    await compressForkSession(currentSessionPath);
  }, [forking, currentSessionPath]);

  if (!currentSessionPath || (!compressionAvailable && !forking)) return null;

  return (
    <button
      type="button"
      className={`${styles['context-compress-action-btn']}${forking ? ` ${styles.forking}` : ''}`}
      onClick={handleCompressFork}
      disabled={forking}
    >
      {forking ? t('settings.context.compressing') : t('settings.context.compressFork')}
    </button>
  );
}
