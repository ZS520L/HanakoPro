import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../store';
import { hanaFetch } from '../../api';
import { t, autoSaveConfig, savePins } from '../../helpers';
import { PinItem } from './AgentPins';
import { SettingsSection } from '../../components/SettingsSection';
import styles from '../../Settings.module.css';

type VisibleCompiledMemoryItem = {
  id: string;
  source: string;
  index: number;
  text: string;
};

type VisibleCompiledMemorySection = {
  source: string;
  title: string;
  englishTitle?: string;
  items: VisibleCompiledMemoryItem[];
};

type VisibleFactMemory = {
  id: number;
  fact: string;
  tags?: string[];
  time?: string | null;
  created_at?: string | null;
};

type VisibleMemoryState = {
  willInjectMemory: boolean;
  memoryMasterEnabled: boolean;
  promptRuntimeMemoryEnabled: boolean;
  compiledSections: VisibleCompiledMemorySection[];
  facts: VisibleFactMemory[];
};

function memoryMatches(text: string, query: string) {
  return !query || text.toLowerCase().includes(query);
}

function formatMemoryTime(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function MemorySection({ hasUtilityModel, memoryEnabled, isViewingOther, currentPins }: {
  hasUtilityModel: boolean;
  memoryEnabled: boolean;
  isViewingOther: boolean;
  currentPins: string[];
}) {
  const [pinInput, setPinInput] = useState('');
  const [visibleMemory, setVisibleMemory] = useState<VisibleMemoryState | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySearch, setMemorySearch] = useState('');
  const [memoryFocusFlash, setMemoryFocusFlash] = useState(false);
  const memoryPanelRef = useRef<HTMLDivElement | null>(null);
  const agentId = useSettingsStore(s => s.getSettingsAgentId());
  const showToast = useSettingsStore(s => s.showToast);

  const loadVisibleMemory = useCallback(async () => {
    if (!agentId) return;
    setMemoryLoading(true);
    try {
      const res = await hanaFetch(`/api/memories/visible?agentId=${encodeURIComponent(agentId)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setVisibleMemory(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      setMemoryLoading(false);
    }
  }, [agentId, showToast]);

  useEffect(() => {
    void loadVisibleMemory();
  }, [loadVisibleMemory, memoryEnabled]);

  useEffect(() => {
    const focusMemoryPanel = () => {
      const panel = memoryPanelRef.current;
      if (!panel) return;
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setMemoryFocusFlash(true);
      window.setTimeout(() => setMemoryFocusFlash(false), 1800);
      void loadVisibleMemory();
    };
    const pendingFocus = window.sessionStorage?.getItem('hana-settings-focus');
    if (pendingFocus === 'memory-management') {
      window.sessionStorage.removeItem('hana-settings-focus');
      window.setTimeout(focusMemoryPanel, 80);
    }
    window.addEventListener('hana-focus-memory-management', focusMemoryPanel);
    return () => window.removeEventListener('hana-focus-memory-management', focusMemoryPanel);
  }, [loadVisibleMemory]);

  const query = memorySearch.trim().toLowerCase();
  const visiblePins = useMemo(
    () => currentPins
      .map((text, index) => ({ id: `pin:${index}`, text, index }))
      .filter(item => memoryMatches(item.text, query)),
    [currentPins, query]
  );
  const visibleCompiledSections = useMemo(
    () => (visibleMemory?.compiledSections || [])
      .map(section => ({
        ...section,
        items: section.items.filter(item => memoryMatches(item.text, query)),
      }))
      .filter(section => section.items.length > 0),
    [visibleMemory, query]
  );
  const visibleFacts = useMemo(
    () => (visibleMemory?.facts || [])
      .filter(item => memoryMatches(`${item.fact} ${(item.tags || []).join(' ')}`, query))
      .slice(0, query ? 100 : 30),
    [visibleMemory, query]
  );

  const deleteCompiledMemoryItem = async (item: VisibleCompiledMemoryItem) => {
    if (!agentId) return;
    if (isViewingOther) {
      showToast(t('settings.memory.activeOnly'), 'error');
      return;
    }
    if (!window.confirm('删除这条已编译记忆？它会立即从 system prompt 的记忆块中移除。')) return;
    try {
      const res = await hanaFetch(
        `/api/memories/compiled-items/${encodeURIComponent(item.source)}/${item.index}?agentId=${encodeURIComponent(agentId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast('已删除编译记忆', 'success');
      await loadVisibleMemory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const deleteFactMemory = async (item: VisibleFactMemory) => {
    if (!agentId) return;
    if (isViewingOther) {
      showToast(t('settings.memory.activeOnly'), 'error');
      return;
    }
    if (!window.confirm('删除这条自动事实记忆？')) return;
    try {
      const res = await hanaFetch(`/api/memories/${item.id}?agentId=${encodeURIComponent(agentId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast('已删除自动事实记忆', 'success');
      await loadVisibleMemory();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const addPin = () => {
    const val = pinInput.trim();
    if (!val) return;
    const newPins = [...currentPins, val];
    useSettingsStore.setState({ currentPins: newPins });
    setPinInput('');
    savePins();
  };

  const deletePin = (index: number) => {
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
                  <PinItem key={pin} text={pin} index={i} onDelete={deletePin} />
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
              />
              <button className={styles['pin-add-btn']} onClick={addPin}>+</button>
            </div>
          </div>

          <div className={styles['settings-subsection']}>
            <div className={styles['settings-subsection-header']}>
              <h3 className={styles['settings-subsection-title']}>可见记忆</h3>
              <span className={styles['settings-subsection-hint']}>直接展示会进入 system prompt 的记忆，以及底层自动事实记忆。</span>
            </div>
            <div
              ref={memoryPanelRef}
              className={`${styles['memory-visible-panel']} ${memoryFocusFlash ? styles['memory-visible-panel-focus'] : ''}`}
              data-memory-management
            >
              <div className={styles['memory-visible-toolbar']}>
                <input
                  className={`${styles['settings-input']} ${styles['memory-visible-search']}`}
                  value={memorySearch}
                  onChange={(event) => setMemorySearch(event.target.value)}
                  placeholder="Search memories"
                />
                <button className={`${styles['memory-action-btn']} ${styles['secondary']}`} onClick={loadVisibleMemory} disabled={memoryLoading}>
                  {memoryLoading ? '刷新中…' : '刷新'}
                </button>
              </div>
              <div className={styles['memory-visible-status']}>
                {visibleMemory?.willInjectMemory
                  ? '记忆注入开启：下面的置顶记忆和编译记忆会进入新会话 system prompt。'
                  : '当前没有记忆会注入：可能是记忆总开关关闭、Prompt Composer 记忆注入关闭，或暂无置顶/编译记忆。'}
              </div>

              <div className={styles['memory-visible-group']}>
                <div className={styles['memory-visible-group-title']}>
                  <span>置顶记忆</span>
                  <span>{visiblePins.length}</span>
                </div>
                {visiblePins.length === 0 ? (
                  <div className={styles['memory-visible-empty']}>暂无匹配的置顶记忆。</div>
                ) : (
                  <div className={styles['memory-visible-list']}>
                    {visiblePins.map(item => (
                      <div key={item.id} className={styles['memory-visible-item']}>
                        <div className={styles['memory-visible-item-content']}>{item.text}</div>
                        <button className={styles['memory-visible-delete']} onClick={() => deletePin(item.index)} disabled={isViewingOther}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles['memory-visible-group']}>
                <div className={styles['memory-visible-group-title']}>
                  <span>已编译进 system prompt 的记忆</span>
                  <span>{visibleCompiledSections.reduce((sum, section) => sum + section.items.length, 0)}</span>
                </div>
                {visibleCompiledSections.length === 0 ? (
                  <div className={styles['memory-visible-empty']}>暂无匹配的编译记忆。</div>
                ) : (
                  <div className={styles['memory-visible-list']}>
                    {visibleCompiledSections.map(section => (
                      <div key={section.source} className={styles['memory-visible-section']}>
                        <div className={styles['memory-visible-section-title']}>{section.title}</div>
                        {section.items.map(item => (
                          <div key={item.id} className={styles['memory-visible-item']}>
                            <div className={styles['memory-visible-item-content']}>{item.text}</div>
                            <button className={styles['memory-visible-delete']} onClick={() => deleteCompiledMemoryItem(item)} disabled={isViewingOther}>×</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles['memory-visible-group']}>
                <div className={styles['memory-visible-group-title']}>
                  <span>底层自动事实记忆</span>
                  <span>{visibleFacts.length}{!query && visibleMemory && visibleMemory.facts.length > visibleFacts.length ? ` / ${visibleMemory.facts.length}` : ''}</span>
                </div>
                {visibleFacts.length === 0 ? (
                  <div className={styles['memory-visible-empty']}>暂无匹配的自动事实记忆。</div>
                ) : (
                  <div className={styles['memory-visible-list']}>
                    {visibleFacts.map(item => (
                      <div key={item.id} className={styles['memory-visible-item']}>
                        <div className={styles['memory-visible-item-main']}>
                          <div className={styles['memory-visible-item-content']}>{item.fact}</div>
                          <div className={styles['memory-visible-item-meta']}>
                            {formatMemoryTime(item.time || item.created_at)}
                            {(item.tags || []).map(tag => <span key={tag}>#{tag}</span>)}
                          </div>
                        </div>
                        <button className={styles['memory-visible-delete']} onClick={() => deleteFactMemory(item)} disabled={isViewingOther}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles['settings-subsection']}>
            <div className={styles['settings-subsection-header']}>
              <h3 className={styles['settings-subsection-title']}>{t('settings.memory.compiled')}</h3>
              <span className={styles['settings-subsection-hint']}>{t('settings.memory.compiledHint')}</span>
            </div>
            <button
              className={`${styles['memory-action-btn']} ${styles['compiled-view-btn']}`}
              onClick={() => window.dispatchEvent(new Event('hana-view-compiled-memory'))}
            >
              {t('settings.memory.compiledView')}
            </button>
          </div>

          <div className={styles['settings-subsection']}>
            <h3 className={styles['settings-subsection-title']}>{t('settings.memory.allMemories')}</h3>
            <div className={`${styles['memory-actions-row']} ${styles['memory-actions-spaced']}`}>
              <button
                className={styles['memory-action-btn']}
                onClick={() => window.dispatchEvent(new Event('hana-view-memories'))}
              >
                {t('settings.memory.actions.view')}
              </button>
              <button
                className={`${styles['memory-action-btn']} ${styles['danger']}`}
                onClick={() => window.dispatchEvent(new Event('hana-show-clear-confirm'))}
              >
                {t('settings.memory.actions.clear')}
              </button>
              <MemoryMoreDropdown isViewingOther={isViewingOther} />
            </div>
          </div>
        </div>{/* settings-disabled wrapper */}
      </div>
    </SettingsSection>
  );
}

function MemoryMoreDropdown({ isViewingOther }: { isViewingOther: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Only actions needed — use getState() to avoid subscribing to the full store
  const getStore = () => useSettingsStore.getState();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  const exportMemories = async () => {
    setOpen(false);
    try {
      const aid = getStore().getSettingsAgentId();
      const res = await hanaFetch(`/api/memories/export?agentId=${aid}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      // eslint-disable-next-line no-restricted-syntax -- ephemeral download link for memory export
      const a = document.createElement('a');
      a.href = url;
      a.download = `hana-memories-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      getStore().showToast(t('settings.memory.actions.exportSuccess'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      getStore().showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const importMemories = async () => {
    setOpen(false);
    // eslint-disable-next-line no-restricted-syntax -- ephemeral file picker for memory import
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const entries = json.facts || json.memories;
        if (!Array.isArray(entries) || entries.length === 0) {
          getStore().showToast(t('settings.memory.actions.invalidFile'), 'error');
          return;
        }
        getStore().showToast(t('settings.memory.actions.importing'), 'success');
        const aid = getStore().getSettingsAgentId();
        const res = await hanaFetch(`/api/memories/import?agentId=${aid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facts: entries }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const importMsg = t('settings.memory.actions.importSuccess').replace('{count}', data.imported);
        getStore().showToast(importMsg, 'success');
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        getStore().showToast(t('settings.saveFailed') + ': ' + errMsg, 'error');
      }
    });
    input.click();
  };

  return (
    <div className={`${styles['memory-action-dropdown']}${open  ? ' ' + styles['open'] : ''}`} ref={ref}>
      <button className={`${styles['memory-action-btn']} ${styles['secondary']}`} onClick={() => setOpen(!open)}>
        <span>{t('settings.memory.actions.more')}</span>
        <svg className={styles['memory-more-arrow']} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={styles['memory-more-popup']}>
        <button className={styles['memory-more-option']} onClick={exportMemories}>
          {t('settings.memory.actions.export')}
        </button>
        <button
          className={styles['memory-more-option']}
          onClick={importMemories}
          disabled={isViewingOther}
          title={isViewingOther ? t('settings.memory.activeOnly') : ''}
        >
          {t('settings.memory.actions.import')}
        </button>
      </div>
    </div>
  );
}
