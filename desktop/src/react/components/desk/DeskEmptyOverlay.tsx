/**
 * DeskEmptyOverlay — 未设置工作空间路径时的空状态提示
 */

import { useStore } from '../../stores';
import { openSettingsModal } from '../../stores/settings-modal-actions';
import { ICONS } from './desk-types';
import s from './Desk.module.css';

export function DeskEmptyOverlay() {
  const deskBasePath = useStore(s => s.deskBasePath);

  if (deskBasePath) return null;

  return (
    <div className={s.emptyOverlay}>
      <p className={s.emptyText}>{(window.t ?? ((p: string) => p))('desk.emptyTitle')}</p>
      <p className={s.emptyHint}>
        {(window.t ?? ((p: string) => p))('desk.emptyHint')}
      </p>
      <button className={s.emptyBtn} onClick={() => openSettingsModal('work')}>
        <span dangerouslySetInnerHTML={{ __html: ICONS.settings }} />
        {(window.t ?? ((p: string) => p))('desk.goToSettings')}
      </button>
    </div>
  );
}
