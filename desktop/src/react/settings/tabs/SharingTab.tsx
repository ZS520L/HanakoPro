import React, { useState } from 'react';
import { t } from '../helpers';
import styles from '../Settings.module.css';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { NumberInput } from '../components/NumberInput';
import {
  SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT,
  SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT_STORAGE_KEY,
  readScreenshotSegmentVisibleCharLimit,
} from '../../utils/screenshot-segments';

// 静态预览图（由 scripts/generate-screenshot-previews.cjs 生成）
import lightMobile from '../../../assets/screenshot-previews/light-mobile.png';
import lightDesktop from '../../../assets/screenshot-previews/light-desktop.png';
import darkMobile from '../../../assets/screenshot-previews/dark-mobile.png';
import darkDesktop from '../../../assets/screenshot-previews/dark-desktop.png';
import sakuraMobile from '../../../assets/screenshot-previews/sakura-mobile.png';
import sakuraDesktop from '../../../assets/screenshot-previews/sakura-desktop.png';

const PREVIEW_IMAGES: Record<string, string> = {
  'light-mobile': lightMobile,
  'light-desktop': lightDesktop,
  'dark-mobile': darkMobile,
  'dark-desktop': darkDesktop,
  'sakura-mobile': sakuraMobile,
  'sakura-desktop': sakuraDesktop,
};

export function SharingTab() {
  const [screenshotColor, setScreenshotColor] = useState(
    () => localStorage.getItem('hana-screenshot-color') || 'light'
  );
  const [screenshotWidth, setScreenshotWidth] = useState(
    () => localStorage.getItem('hana-screenshot-width') || 'mobile'
  );
  const [segmentLimit, setSegmentLimit] = useState(() => readScreenshotSegmentVisibleCharLimit());

  const handleSegmentLimitChange = (value: number) => {
    const next = Math.max(1_000, Math.min(100_000, Math.round(value)));
    setSegmentLimit(next);
    if (next === SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT) {
      localStorage.removeItem(SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT_STORAGE_KEY);
    } else {
      localStorage.setItem(SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT_STORAGE_KEY, String(next));
    }
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="sharing">
      <SettingsSection title={t('settings.screenshot.color')} variant="flush">
        <div className={styles['theme-options']}>
          {([
            { key: 'light' as const, bg: '#F8F5ED', color: '#3B3D3F', accent: '#537D96' },
            { key: 'dark' as const, bg: '#2D4356', color: '#C8D1D8', accent: '#A76F6F' },
            { key: 'sakura' as const, bg: '#8ABDCE', color: '#FFFFFF', accent: 'rgba(255,255,255,0.7)' },
          ]).map(({ key, bg, color, accent }) => (
            <button
              key={key}
              className={`${styles['theme-card']}${screenshotColor === key ? ' ' + styles['active'] : ''}`}
              style={{ background: bg }}
              onClick={() => { setScreenshotColor(key); localStorage.setItem('hana-screenshot-color', key); }}
            >
              <div className={styles['theme-card-name']} style={{ color }}>{t(`settings.screenshot.${key}`)}</div>
              <div className={styles['theme-card-mode']} style={{ color: accent }}>{t('settings.screenshot.title')}</div>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.screenshot.width')} variant="flush">
        <div className={styles['ss-layout-group']}>
          {([
            { width: 'mobile' as const, title: t('settings.screenshot.mobileTitle'), desc: t('settings.screenshot.mobileDesc') },
            { width: 'desktop' as const, title: t('settings.screenshot.desktopTitle'), desc: t('settings.screenshot.desktopDesc') },
          ]).map(({ width, title, desc }) => {
            const key = `${screenshotColor}-${width}`;
            const src = PREVIEW_IMAGES[key];
            return (
              <button
                key={width}
                className={`${styles['ss-layout-card']}${screenshotWidth === width ? ' ' + styles['active'] : ''}`}
                onClick={() => { setScreenshotWidth(width); localStorage.setItem('hana-screenshot-width', width); }}
              >
                <div className={styles['ss-layout-preview']}>
                  {src ? (
                    <img src={src} alt={title} draggable={false} />
                  ) : null}
                </div>
                <div className={styles['ss-layout-info']}>
                  <div className={styles['ss-layout-title']}>{title}</div>
                  <div className={styles['ss-layout-desc']}>{desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.screenshot.segmentTitle')}>
        <SettingsRow
          label={t('settings.screenshot.segmentLimitLabel')}
          hint={t('settings.screenshot.segmentLimitHint')}
          control={
            <NumberInput
              value={segmentLimit}
              onChange={handleSegmentLimitChange}
              min={1000}
              max={100000}
              step={1000}
              fieldWidth="wide"
              unit={t('settings.screenshot.segmentLimitUnit')}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
