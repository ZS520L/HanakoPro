import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from './store';
import styles from './Settings.module.css';

export function Toast() {
  const { toastMessage, toastType, toastVisible } = useSettingsStore(
    useShallow(s => ({ toastMessage: s.toastMessage, toastType: s.toastType, toastVisible: s.toastVisible }))
  );
  const cls = [styles['settings-toast']];
  if (toastType) cls.push(styles[toastType]);
  if (toastVisible) cls.push(styles['show']);
  return (
    <div className={cls.join(' ')}>
      {toastMessage}
    </div>
  );
}
