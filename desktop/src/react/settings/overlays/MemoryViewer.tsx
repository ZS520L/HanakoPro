import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';

type MemoryFact = {
  id: number;
  fact: string;
  tags?: string[];
  time?: string | null;
  created_at?: string | null;
};

function parseTagsInput(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of value.split(/[,，]/).map(item => item.trim()).filter(Boolean)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function MemoryViewer() {
  const [visible, setVisible] = useState(false);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftFact, setDraftFact] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const showToast = useSettingsStore(s => s.showToast);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const aid = useSettingsStore.getState().getSettingsAgentId();
      const res = await hanaFetch(`/api/memories?agentId=${aid}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMemories(Array.isArray(data.memories) ? data.memories : []);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      setVisible(true);
      setEditingId(null);
      void loadMemories();
    };
    window.addEventListener('hana-view-memories', handler);
    return () => window.removeEventListener('hana-view-memories', handler);
  }, [loadMemories]);

  const close = useCallback(() => setVisible(false), []);

  const startEdit = (memory: MemoryFact) => {
    setEditingId(memory.id);
    setDraftFact(memory.fact || '');
    setDraftTags((memory.tags || []).join(', '));
    setDraftTime(memory.time || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftFact('');
    setDraftTags('');
    setDraftTime('');
  };

  const saveEdit = async (memory: MemoryFact) => {
    const fact = draftFact.trim();
    if (!fact) {
      showToast(t('settings.memory.actions.factRequired'), 'error');
      return;
    }

    setSavingId(memory.id);
    try {
      const aid = useSettingsStore.getState().getSettingsAgentId();
      const res = await hanaFetch(`/api/memories/${memory.id}?agentId=${aid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fact,
          tags: parseTagsInput(draftTags),
          time: draftTime.trim() || null,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const updated = data.memory as MemoryFact;
      setMemories(prev => prev.map(item => item.id === updated.id ? updated : item));
      cancelEdit();
      showToast(t('settings.memory.actions.editSuccess'), 'success');
    } catch (err: any) {
      showToast(t('settings.saveFailed') + ': ' + (err.message || String(err)), 'error');
    } finally {
      setSavingId(null);
    }
  };

  const grouped = memories.reduce<Record<string, MemoryFact[]>>((acc, memory) => {
    const date = (memory.time || memory.created_at || '').slice(0, 10) || t('settings.memory.unknownDate');
    if (!acc[date]) acc[date] = [];
    acc[date].push(memory);
    return acc;
  }, {});
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <Overlay
      open={visible}
      onClose={close}
      backdrop="blur"
      zIndex={100}
      className={styles['memory-viewer']}
      disableContainerAnimation
    >
        <div className={styles['memory-viewer-header']}>
          <h3 className={styles['memory-viewer-title']}>{t('settings.memory.actions.viewTitle')}</h3>
          <button className={styles['memory-viewer-close']} onClick={close}>✕</button>
        </div>
        <div className={styles['memory-viewer-body']}>
          {loading ? (
            <div className="memory-viewer-empty">{t('settings.memory.actions.importing')}</div>
          ) : error ? (
            <div className="memory-viewer-empty">{error}</div>
          ) : memories.length === 0 ? (
            <div className="memory-viewer-empty">{t('settings.memory.actions.empty')}</div>
          ) : (
            <div className={styles['memory-list']}>
              {sortedDates.map(date => (
                <div className={styles['memory-date-group']} key={date}>
                  <div className={styles['memory-date-label']}>{date}</div>
                  {grouped[date].map(memory => {
                    const isEditing = editingId === memory.id;
                    const isSaving = savingId === memory.id;
                    return (
                      <div className={styles['memory-item']} key={memory.id}>
                        {isEditing ? (
                          <div className={styles['memory-edit-form']}>
                            <textarea
                              className={styles['memory-edit-textarea']}
                              value={draftFact}
                              onChange={(e) => setDraftFact(e.target.value)}
                              placeholder={t('settings.memory.actions.factPlaceholder')}
                              rows={4}
                            />
                            <input
                              className={styles['memory-edit-input']}
                              value={draftTags}
                              onChange={(e) => setDraftTags(e.target.value)}
                              placeholder={t('settings.memory.actions.tagsPlaceholder')}
                            />
                            <input
                              className={styles['memory-edit-input']}
                              value={draftTime}
                              onChange={(e) => setDraftTime(e.target.value)}
                              placeholder={t('settings.memory.actions.timePlaceholder')}
                            />
                            <div className={styles['memory-item-actions']}>
                              <button
                                className={styles['memory-item-secondary']}
                                onClick={cancelEdit}
                                disabled={isSaving}
                              >
                                {t('settings.memory.actions.cancel')}
                              </button>
                              <button
                                className={styles['memory-item-primary']}
                                onClick={() => saveEdit(memory)}
                                disabled={isSaving}
                              >
                                {isSaving ? t('settings.memory.actions.saving') : t('settings.memory.actions.save')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className={styles['memory-item-content']}>{memory.fact || ''}</div>
                            <div className={styles['memory-item-meta']}>
                              {(memory.tags || []).map(tag => (
                                <span className={styles['memory-item-tag']} key={tag}>{tag}</span>
                              ))}
                              {memory.time && <span className={styles['memory-item-time']}>{memory.time}</span>}
                            </div>
                            <div className={styles['memory-item-actions']}>
                              <button className={styles['memory-item-secondary']} onClick={() => startEdit(memory)}>
                                {t('settings.memory.actions.edit')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
    </Overlay>
  );
}
