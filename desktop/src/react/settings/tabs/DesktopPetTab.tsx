import { useState, useEffect } from 'react';
import { useSettingsStore } from '../store';
import type { DesktopPetMood, DesktopPetState } from '../../types';
import { t } from '../helpers';
import styles from '../Settings.module.css';

const DESKTOP_PET_MOODS: Array<{ mood: DesktopPetMood; label: string }> = [
  { mood: 'idle', label: '待机中' },
  { mood: 'thinking', label: '思考中' },
  { mood: 'talking', label: '回复中' },
  { mood: 'working', label: '工作中' },
  { mood: 'happy', label: '完成啦' },
  { mood: 'error', label: '遇到问题' },
  { mood: 'cute', label: '撒娇中' },
  { mood: 'sad', label: '哭泣中' },
  { mood: 'missing', label: '思念中' },
];

function desktopPetPreviewSrc(state: DesktopPetState | null, mood: DesktopPetMood): string {
  const customImage = state?.customImages?.[mood];
  if (customImage) return window.platform?.getFileUrl?.(customImage) || customImage;
  return `assets/desktop-pet/hanako/${mood}.png`;
}

export function DesktopPetTab() {
  const showToast = useSettingsStore(s => s.showToast);
  const [desktopPetState, setDesktopPetState] = useState<DesktopPetState | null>(null);
  const [desktopPetBusyMood, setDesktopPetBusyMood] = useState<DesktopPetMood | null>(null);

  useEffect(() => {
    let mounted = true;
    window.platform?.desktopPetGetState?.().then((next) => {
      if (mounted && next) setDesktopPetState(next);
    }).catch(() => {});
    const dispose = window.platform?.onDesktopPetState?.((next) => {
      setDesktopPetState((prev) => prev ? { ...prev, ...next } : next as DesktopPetState);
    });
    return () => {
      mounted = false;
      if (typeof dispose === 'function') dispose();
    };
  }, []);

  const customDesktopPetImages = desktopPetState?.customImages || {};

  const selectDesktopPetImage = async (mood: DesktopPetMood) => {
    if (desktopPetBusyMood) return;
    setDesktopPetBusyMood(mood);
    try {
      const next = await window.platform?.desktopPetSelectCustomImage?.(mood);
      if (next) {
        setDesktopPetState(next);
        showToast('桌宠图片已更新', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      setDesktopPetBusyMood(null);
    }
  };

  const resetDesktopPetImage = async (mood: DesktopPetMood) => {
    if (desktopPetBusyMood) return;
    setDesktopPetBusyMood(mood);
    try {
      const next = await window.platform?.desktopPetResetCustomImage?.(mood);
      if (next) setDesktopPetState(next);
      showToast('已恢复内置桌宠图片', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      setDesktopPetBusyMood(null);
    }
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="desktop-pet">
      <section className={styles['settings-section']}>
        <h2 className={styles['settings-section-title']}>桌宠形象</h2>
        <div className={styles['desktop-pet-custom-grid']}>
          {DESKTOP_PET_MOODS.map(({ mood, label }) => {
            const isCustom = !!customDesktopPetImages[mood];
            const isBusy = desktopPetBusyMood === mood;
            return (
              <div className={styles['desktop-pet-custom-card']} key={mood}>
                <div className={styles['desktop-pet-custom-preview']}>
                  <img
                    src={desktopPetPreviewSrc(desktopPetState, mood)}
                    alt={label}
                    onError={(event) => {
                      if (event.currentTarget.dataset.fallbackApplied === 'true') return;
                      event.currentTarget.dataset.fallbackApplied = 'true';
                      event.currentTarget.src = `assets/desktop-pet/hanako/${mood}.png`;
                    }}
                  />
                </div>
                <div className={styles['desktop-pet-custom-meta']}>
                  <span className={styles['desktop-pet-custom-label']}>{label}</span>
                  <span className={styles['desktop-pet-custom-state']}>{isCustom ? '自定义' : '内置'}</span>
                </div>
                <div className={styles['desktop-pet-custom-actions']}>
                  <button
                    type="button"
                    className={styles['desktop-pet-custom-button']}
                    disabled={!!desktopPetBusyMood}
                    onClick={() => selectDesktopPetImage(mood)}
                  >
                    {isBusy ? '处理中' : '选择'}
                  </button>
                  <button
                    type="button"
                    className={styles['desktop-pet-custom-button']}
                    disabled={!isCustom || !!desktopPetBusyMood}
                    onClick={() => resetDesktopPetImage(mood)}
                  >
                    重置
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <span className={styles['settings-form-hint']}>支持 PNG、JPG、WebP、GIF。图片会复制到本地用户目录，桌宠窗口会实时优先使用自定义图片。</span>
      </section>
    </div>
  );
}
