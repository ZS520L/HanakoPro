import React, { useState } from 'react';
import { useSettingsStore } from '../../store';
import { t, autoSaveConfig, savePins } from '../../helpers';
import { PinItem } from './AgentPins';
import { SettingsSection } from '../../components/SettingsSection';
import { buildPinnedMemoryMarkdown, mergePinnedMemories, parsePinnedMemoryMarkdown } from './pinned-memory-markdown';
import styles from '../../Settings.module.css';

export function MemorySection({ hasUtilityModel, memoryEnabled, isViewingOther, currentPins }: {
  hasUtilityModel: boolean;
  memoryEnabled: boolean;
  isViewingOther: boolean;
  currentPins: string[];
}) {
  const [pinInput, setPinInput] = useState('');
  const showToast = useSettingsStore(s => s.showToast);

  const saveImportedPins = (nextPins: string[], importedCount: number) => {
    useSettingsStore.setState({ currentPins: nextPins });
    savePins();
    showToast(t('settings.pins.importSuccess', { count: importedCount }), 'success');
  };

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

  const exportPins = async () => {
    const markdown = buildPinnedMemoryMarkdown(currentPins);
    if (window.platform?.saveMarkdownFile) {
      const filePath = await window.platform.saveMarkdownFile('hanakopro-pinned-memory.md');
      if (!filePath) return;
      const ok = await window.platform.writeFile(filePath, markdown);
      if (!ok) {
        showToast(t('settings.saveFailed'), 'error');
        return;
      }
      showToast(t('settings.pins.exportSuccess'), 'success');
      return;
    }

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hanakopro-pinned-memory.md';
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(t('settings.pins.exportSuccess'), 'success');
  };

  const importPinsFromMarkdown = (markdown: string) => {
    const importedPins = parsePinnedMemoryMarkdown(markdown);
    if (importedPins.length === 0) {
      showToast(t('settings.pins.importInvalid'), 'error');
      return;
    }
    const nextPins = mergePinnedMemories(currentPins, importedPins);
    saveImportedPins(nextPins, nextPins.length - currentPins.length);
  };

  const importPins = async () => {
    if (isViewingOther) {
      showToast(t('settings.memory.activeOnly'), 'error');
      return;
    }

    if (window.platform?.selectMarkdownFile) {
      const filePath = await window.platform.selectMarkdownFile();
      if (!filePath) return;
      const markdown = await window.platform.readFile(filePath);
      if (markdown == null) {
        showToast(t('settings.pins.importInvalid'), 'error');
        return;
      }
      importPinsFromMarkdown(markdown);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,text/markdown,text/plain';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      importPinsFromMarkdown(await file.text());
    });
    input.click();
  };

  /* 记忆开关作为 section title 右侧 context（和 WorkTab 的 AgentSelect 作 context 同构）
   * 把导入/导出按钮放在开关左边，避免挤压副标题说明 */
  const memoryHeaderContext = (
    <div className={styles['pin-file-actions']}>
      <button
        className={styles['pin-file-action-btn']}
        onClick={importPins}
        disabled={isViewingOther}
        title={t('settings.pins.importTitle')}
      >
        {t('settings.pins.import')}
      </button>
      <button
        className={styles['pin-file-action-btn']}
        onClick={exportPins}
        disabled={currentPins.length === 0}
        title={t('settings.pins.exportTitle')}
      >
        {t('settings.pins.export')}
      </button>
      <button
        className={`hana-toggle${hasUtilityModel && memoryEnabled ? ' on' : ''}${!hasUtilityModel ? ' disabled' : ''}`}
        onClick={() => hasUtilityModel && autoSaveConfig({ memory: { enabled: !memoryEnabled } })}
        disabled={!hasUtilityModel}
        title={!hasUtilityModel ? t('settings.memory.needsUtilityModel') : undefined}
      />
    </div>
  );

  return (
    <SettingsSection title={t('settings.memory.sectionTitle')} context={memoryHeaderContext}>
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
