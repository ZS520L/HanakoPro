import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { invalidateConfigCache } from '../../hooks/use-config';
import { useI18n } from '../../hooks/use-i18n';
import { useStore } from '../../stores';
import type { ThinkingLevel } from '../../stores/model-slice';
import styles from './InputArea.module.css';

const ALL_THINKING_LEVELS: ThinkingLevel[] = ['off', 'auto', 'high', 'xhigh'];

export function ThinkingLevelButton({ level, onChange, modelXhigh }: {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  modelXhigh: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const pendingNewSession = useStore(s => s.pendingNewSession);

  const availableLevels = useMemo(() => {
    return ALL_THINKING_LEVELS.filter(lv => lv !== 'xhigh' || modelXhigh);
  }, [modelXhigh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectLevel = useCallback(async (next: ThinkingLevel) => {
    setOpen(false);
    try {
      const useSessionThinking = !!currentSessionPath && !pendingNewSession;
      const res = await hanaFetch(useSessionThinking ? '/api/session-thinking-level' : '/api/config', {
        method: useSessionThinking ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: useSessionThinking
          ? JSON.stringify({ sessionPath: currentSessionPath, level: next })
          : JSON.stringify({ thinking_level: next }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'failed to save thinking level');
      }
      onChange((data?.thinkingLevel || next) as ThinkingLevel);
      if (!useSessionThinking) invalidateConfigCache();
    } catch (err) {
      console.error('[thinking-level] save failed:', err);
    }
  }, [currentSessionPath, onChange, pendingNewSession]);

  const tLevel = (key: string, fallback: string) => {
    const v = t(key);
    return v !== key ? v : fallback;
  };

  const isOff = level === 'off';
  const fillClipId = useId();

  // 玻璃灯泡路径（用于描边和裁剪填充）
  const bulbGlassPath = 'M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5';

  // 根据等级渲染灯泡填充：auto=空 / high=半满 / xhigh=全满
  const renderFill = () => {
    if (isOff || level === 'auto') return null;
    if (level === 'high') {
      return (
        <g clipPath={`url(#${fillClipId})`}>
          <rect x="2" y="8" width="20" height="10" fill="currentColor" fillOpacity="0.4" />
        </g>
      );
    }
    // xhigh: 全满
    return (
      <g clipPath={`url(#${fillClipId})`}>
        <rect x="2" y="1" width="20" height="16" fill="currentColor" fillOpacity="0.5" />
      </g>
    );
  };

  return (
    <div className={`${styles['thinking-selector']}${open ? ` ${styles.open}` : ''}`} ref={ref}>
      <button
        className={`${styles['thinking-pill']}${isOff ? '' : ` ${styles.active}`}`}
        data-level={level}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {(level === 'high' || level === 'xhigh') && (
            <defs>
              <clipPath id={fillClipId}>
                <path d={bulbGlassPath} />
              </clipPath>
            </defs>
          )}
          {/* 底座和螺口 */}
          <path d="M9 18h6" /><path d="M10 22h4" />
          {/* 玻璃灯泡轮廓 */}
          <path d={bulbGlassPath} />
          {/* 填充层级 */}
          {renderFill()}
          {/* 关闭态：斜线删除线 */}
          {isOff && <line x1="4" y1="4" x2="20" y2="20" strokeWidth="1.5" />}
        </svg>
      </button>
      {open && (
        <div className={styles['thinking-dropdown']}>
          {availableLevels.map(lv => (
            <button
              key={lv}
              className={`${styles['thinking-option']}${lv === level ? ` ${styles.active}` : ''}`}
              onClick={() => selectLevel(lv)}
            >
              <span>{tLevel(`input.thinkingLevel.${lv}`, lv)}</span>
              <span className={styles['thinking-option-desc']}>{tLevel(`input.thinkingDesc.${lv}`, '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
