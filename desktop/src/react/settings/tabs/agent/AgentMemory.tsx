import React, { useState } from 'react';
import { useSettingsStore } from '../../store';
import { t, autoSaveConfig, savePins } from '../../helpers';
import { PinItem } from './AgentPins';
import { SettingsSection } from '../../components/SettingsSection';
import styles from '../../Settings.module.css';

export function MemorySection({ hasUtilityModel, memoryEnabled, isViewingOther, currentPins }: {
  hasUtilityModel: boolean;
  memoryEnabled: boolean;
  isViewingOther: boolean;
  currentPins: string[];
}) {
  const [pinInput, setPinInput] = useState('');
  const showToast = useSettingsStore(s => s.showToast);

  const addPin = () => {
    if (isViewingOther) {
      showToast(t('settings.memory.activeOnly'), 'error');
      return;
    }
    const val = pinInput.trim();
    if (!val) return;
    const newPins = [...currentPins, val];
    useSettingsStore.setState({ currentPins: newPins });
    setPinInput('');
    savePins();
  };

  const deletePin = (index: number) => {
    if (isViewingOther) {
      showToast(t('settings.memory.activeOnly'), 'error');
      return;
    }
    const newPins = [...currentPins];
    newPins.splice(index, 1);
    useSettingsStore.setState({ currentPins: newPins });
    savePins();
  };

  /* 记忆开关作为 section title 右侧 context（和 WorkTab 的 AgentSelect 作 context 同构）
   * hasUtilityModel=false 时 toggle 禁用，below 显示提示 */
  const memoryToggle = (
    <button
      className={`hana-toggle${hasUtilityModel && memoryEnabled ? ' on' : ''}${!hasUtilityModel ? ' disabled' : ''}`}
      onClick={() => hasUtilityModel && autoSaveConfig({ memory: { enabled: !memoryEnabled } })}
      disabled={!hasUtilityModel}
      title={!hasUtilityModel ? t('settings.memory.needsUtilityModel') : undefined}
    />
  );

  return (
    <SettingsSection title={t('settings.memory.sectionTitle')} context={memoryToggle}>
      <div style={{ padding: 'var(--space-sm) var(--space-md)' }}>
        {!hasUtilityModel && (
          <p className={styles['settings-inline-note']} style={{ opacity: 0.6, marginTop: 0, marginBottom: 'var(--space-md)' }}>{t('settings.memory.needsUtilityModel')}</p>
        )}

        <div className={!hasUtilityModel || !memoryEnabled ? 'settings-disabled' : ''}>
          <div className={styles['settings-subsection']}>
            <div className={styles['settings-subsection-header']}>
              <h3 className={styles['settings-subsection-title']}>{t('settings.pins.title')}</h3>
              <span className={styles['settings-subsection-hint']}>{t('settings.pins.hint')}</span>
            </div>
            <div className={styles['pin-list']}>
              {currentPins.length === 0 ? (
                <div className={styles['pin-empty']}>{t('settings.pins.empty')}</div>
              ) : (
                currentPins.map((pin, i) => (
                  <PinItem key={`${pin}-${i}`} text={pin} index={i} onDelete={deletePin} />
                ))
              )}
            </div>
            <div className={styles['pin-add-row']}>
              <input
                className={`${styles['settings-input']} ${styles['pin-add-input']}`}
                type="text"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPin(); } }}
                placeholder={t('settings.pins.addPlaceholder')}
                disabled={isViewingOther}
              />
              <button className={styles['pin-add-btn']} onClick={addPin} disabled={isViewingOther}>+</button>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
