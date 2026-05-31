import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store';
import { t } from '../helpers';
import { MemorySection } from './agent/AgentMemory';
import styles from '../Settings.module.css';

const MEMORY_TUTORIAL_URL = 'https://www.bilibili.com/video/BV1bFGZ6kEXb/?share_source=copy_web&vd_source=4500215f4296928da959d42ffbccf6a7';

export function MemoryTab() {
  const {
    currentAgentId,
    settingsAgentId,
    settingsConfig,
    currentPins,
    globalModelsConfig,
  } = useSettingsStore(
    useShallow(s => ({
      currentAgentId: s.currentAgentId,
      settingsAgentId: s.settingsAgentId,
      settingsConfig: s.settingsConfig,
      currentPins: s.currentPins,
      globalModelsConfig: s.globalModelsConfig,
    })),
  );

  const selectedSettingsAgentId = settingsAgentId || currentAgentId;
  const isViewingOther = selectedSettingsAgentId !== currentAgentId;
  const hasUtilityModel = !!(globalModelsConfig?.models?.utility && globalModelsConfig?.models?.utility_large);
  const memoryEnabled = settingsConfig?.memory?.enabled !== false;
  const openTutorial = () => {
    if (window.platform?.openExternal) {
      window.platform.openExternal(MEMORY_TUTORIAL_URL);
      return;
    }
    window.open(MEMORY_TUTORIAL_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="memory">
      <MemorySection
        hasUtilityModel={hasUtilityModel}
        memoryEnabled={memoryEnabled}
        isViewingOther={isViewingOther}
        currentPins={currentPins}
      />
      <div className={styles['memory-guide-card']}>
        <div className={styles['memory-guide-copy']}>
          <div className={styles['memory-guide-eyebrow']}>{t('settings.memory.guideEyebrow')}</div>
          <div className={styles['memory-guide-title']}>{t('settings.memory.guideTitle')}</div>
          <div className={styles['memory-guide-text']}>
            <p>{t('settings.memory.guideSystemPrompt')}</p>
            <p>{t('settings.memory.guideMasterPlayer')}</p>
          </div>
        </div>
        <button type="button" className={styles['memory-guide-video']} onClick={openTutorial}>
          <span className={styles['memory-guide-video-label']}>{t('settings.memory.guideVideoLabel')}</span>
          <span className={styles['memory-guide-video-title']}>{t('settings.memory.guideVideoTitle')}</span>
          <span className={styles['memory-guide-video-action']}>{t('settings.memory.guideVideoAction')} →</span>
        </button>
      </div>
    </div>
  );
}
