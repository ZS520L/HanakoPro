import { useState, useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { switchToAgent, loadSettingsConfig, loadAgents } from '../actions';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';

export function AgentDeleteOverlay() {
  const { agents, currentAgentId, settingsAgentId } = useSettingsStore(
    useShallow(s => ({ agents: s.agents, currentAgentId: s.currentAgentId, settingsAgentId: s.settingsAgentId }))
  );
  const showToast = useSettingsStore(s => s.showToast);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [nameInput, setNameInput] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const targetId = deleteTargetId || settingsAgentId || currentAgentId;
  const target = agents.find(a => a.id === targetId);

  useEffect(() => {
    const handler = (event: Event) => {
      const agentId = event instanceof CustomEvent && typeof event.detail?.agentId === 'string'
        ? event.detail.agentId
        : null;
      setDeleteTargetId(agentId);
      setStep(1);
      setNameInput('');
      setVisible(true);
    };
    window.addEventListener('hana-show-agent-delete', handler);
    return () => window.removeEventListener('hana-show-agent-delete', handler);
  }, []);

  useEffect(() => {
    if (step === 2) requestAnimationFrame(() => inputRef.current?.focus());
  }, [step]);

  const close = useCallback(() => {
    setVisible(false);
    setDeleteTargetId(null);
  }, []);

  const confirmDelete = async () => {
    if (!target || nameInput.trim() !== target.name) return;
    try {
      if (targetId === currentAgentId) {
        const other = agents.find(a => a.id !== targetId);
        if (!other) throw new Error(t('settings.agent.lastAgent'));
        await switchToAgent(other.id);
      }
      const res = await hanaFetch(`/api/agents/${targetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      close();
      showToast(t('settings.agent.deleted', { name: target.name }), 'success');
      useSettingsStore.setState({ settingsAgentId: null });
      await loadAgents();
      await loadSettingsConfig();
    } catch (err: any) {
      showToast(t('settings.agent.deleteFailed') + ': ' + err.message, 'error');
    }
  };

  if (!target) return null;

  return (
    <Overlay
      open={visible}
      onClose={close}
      backdrop="blur"
      zIndex={110}
      className={styles['agent-delete-card']}
      disableContainerAnimation
    >
        {step === 1 ? (
          <div className={styles['agent-delete-step']}>
            <h3 className={styles['agent-delete-title']}>{t('settings.agent.deleteTitle1', { name: target.name })}</h3>
            <p className={styles['agent-delete-desc']}>{t('settings.agent.deleteDesc1')}</p>
            <div className={styles['agent-delete-actions']}>
              <button className={styles['agent-delete-cancel']} onClick={close}>{t('settings.agent.deleteCancel')}</button>
              <button className={styles['agent-delete-danger']} onClick={() => setStep(2)}>{t('settings.agent.deleteNext')}</button>
            </div>
          </div>
        ) : (
          <div className={styles['agent-delete-step']}>
            <h3 className={styles['agent-delete-title']}>{t('settings.agent.deleteTitle2', { name: target.name })}</h3>
            <div className={styles['settings-form-field']}>
              <input
                ref={inputRef}
                className={`${styles['settings-input']} ${styles['agent-delete-input']}`}
                type="text"
                placeholder={t('settings.agent.deletePlaceholder')}
                autoComplete="off"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmDelete(); }
                }}
              />
            </div>
            <div className={styles['agent-delete-actions']}>
              <button className={styles['agent-delete-cancel']} onClick={close}>{t('settings.agent.deleteCancel')}</button>
              <button
                className={styles['agent-delete-danger']}
                disabled={nameInput.trim() !== target.name}
                onClick={confirmDelete}
              >
                {t('settings.agent.deleteConfirm')}
              </button>
            </div>
          </div>
        )}
    </Overlay>
  );
}
