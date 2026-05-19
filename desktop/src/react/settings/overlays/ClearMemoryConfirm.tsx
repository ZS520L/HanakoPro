import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { Overlay } from '../../ui';
import styles from '../Settings.module.css';

export function ClearMemoryConfirm() {
  const showToast = useSettingsStore(s => s.showToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('hana-show-clear-confirm', handler);
    return () => window.removeEventListener('hana-show-clear-confirm', handler);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const doClear = async () => {
    close();
    try {
      const aid = useSettingsStore.getState().getSettingsAgentId();
      const res = await hanaFetch(`/api/memories?agentId=${aid}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.memory.actions.clearSuccess'), 'success');
    } catch (err: any) {
      showToast(t('settings.saveFailed') + ': ' + err.message, 'error');
    }
  };

  return (
    <Overlay open={visible} onClose={close} backdrop="blur" zIndex={100} className={styles['memory-confirm-card']} disableContainerAnimation>
      <p className={styles['memory-confirm-text']}>{t('settings.memory.actions.clearConfirm')}</p>
      <div className={styles['memory-confirm-actions']}>
        <button className={styles['memory-confirm-cancel']} onClick={close}>{t('settings.memory.actions.cancel')}</button>
        <button className={styles['memory-confirm-danger']} onClick={doClear}>{t('settings.memory.actions.confirmClear')}</button>
      </div>
    </Overlay>
  );
}
