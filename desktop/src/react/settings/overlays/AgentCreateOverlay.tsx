import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { switchToAgent } from '../actions';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';
import { CharacterCardPreviewOverlay, type CharacterCardPlan } from './CharacterCardPreviewOverlay';

export function AgentCreateOverlay() {
  const showToast = useSettingsStore(s => s.showToast);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [yuan, setYuan] = useState('hanako');
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [cardPlan, setCardPlan] = useState<CharacterCardPlan | null>(null);
  const [importMemory, setImportMemory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => {
      setName('');
      setYuan('hanako');
      setCardPlan(null);
      setImportMemory(false);
      setVisible(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('hana-show-agent-create', handler);
    return () => window.removeEventListener('hana-show-agent-create', handler);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setCardPlan(null);
    setImportMemory(false);
    setDragActive(false);
  }, []);

  const create = async () => {
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) { showToast(t('settings.agent.nameRequired'), 'error'); return; }

    setCreating(true);
    try {
      const res = await hanaFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, yuan }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await switchToAgent(data.id);
      close();
      showToast(t('settings.agent.created', { name: data.name }), 'success');
    } catch (err: any) {
      showToast(t('settings.agent.createFailed') + ': ' + err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const planCardFile = async (file: File | null | undefined) => {
    if (!file || planning || creating) return;
    setPlanning(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await hanaFetch('/api/character-cards/plan', {
        method: 'POST',
        body: form,
        timeout: 90_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCardPlan(data.plan);
      setImportMemory(false);
    } catch (err: any) {
      showToast('角色卡读取失败: ' + err.message, 'error');
    } finally {
      setPlanning(false);
      setDragActive(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmCardImport = async () => {
    if (!cardPlan?.token || creating) return;
    setCreating(true);
    try {
      const res = await hanaFetch('/api/character-cards/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cardPlan.token, importMemory }),
        timeout: 90_000,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await switchToAgent(data.agent.id);
      close();
      showToast(t('settings.agent.created', { name: data.agent.name }), 'success');
    } catch (err: any) {
      showToast('角色卡导入失败: ' + err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const types = t('yuan.types') || {};
  const entries = Object.entries(types) as [string, any][];

  return (
    <>
    <Overlay
      open={visible && !cardPlan}
      onClose={close}
      backdrop="blur"
      closeOnBackdrop={!creating && !planning}
      closeOnEsc={!creating && !planning}
      zIndex={110}
      className={styles['agent-create-card']}
      disableContainerAnimation
    >
        <h3 className={styles['agent-create-title']}>{t('settings.agent.createTitle')}</h3>
        <div className={styles['settings-form-field']}>
          <input
            ref={inputRef}
            className={styles['settings-input']}
            type="text"
            placeholder={t('settings.agent.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={creating}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              if (e.key === 'Escape' && !creating) close();
            }}
          />
        </div>
        <div className={styles['settings-form-field']}>
          <div className="yuan-selector">
            <div className="yuan-chips">
              {entries.map(([key, meta]) => (
                <button
                  key={key}
                  className={`yuan-chip${key === yuan ? ' selected' : ''}`}
                  type="button"
                  disabled={creating || planning}
                  onClick={() => setYuan(key)}
                >
                  <img className="yuan-chip-avatar" src={`assets/${meta.avatar || 'Hanako.png'}`} draggable={false} />
                  <div className="yuan-chip-info">
                    <span className="yuan-chip-name">{key}</span>
                    <span className="yuan-chip-desc">{meta.label || ''}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={styles['settings-form-field']}>
          <input
            ref={fileRef}
            className={styles['character-card-file-input']}
            type="file"
            accept=".zip,.hana-package,.json,.yaml,.yml"
            onChange={(event) => planCardFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className={`${styles['character-card-drop-target']} ${dragActive ? styles['character-card-drop-target-active'] : ''}`}
            disabled={creating || planning}
            onClick={() => fileRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              planCardFile(event.dataTransfer.files?.[0]);
            }}
          >
            <span className={styles['character-card-drop-plus']}>+</span>
            <span>{planning ? '正在读取角色卡' : '拖入角色卡或点击打开'}</span>
          </button>
        </div>
        <div className={styles['agent-create-actions']}>
          <button className={styles['agent-create-cancel']} onClick={close} disabled={creating || planning}>{t('settings.agent.cancel')}</button>
          <button className={styles['agent-create-confirm']} onClick={create} disabled={creating}>
            {creating ? t('settings.agent.creating') : t('settings.agent.confirm')}
          </button>
        </div>
    </Overlay>
    {visible && cardPlan && (
      <CharacterCardPreviewOverlay
        plan={cardPlan}
        mode="import"
        memoryChecked={importMemory}
        processing={creating}
        onMemoryChange={setImportMemory}
        onConfirm={confirmCardImport}
        onCancel={close}
      />
    )}
    </>
  );
}
