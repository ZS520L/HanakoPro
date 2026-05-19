/**
 * ChannelHeader — 频道头部（名称、成员数、操作按钮）
 */

import { useCallback, useState } from 'react';
import { useStore } from '../../stores';
import { useI18n } from '../../hooks/use-i18n';
import { deleteChannel } from '../../stores/channel-actions';
import { ContextMenu, type ContextMenuItem } from '../../ui';
import styles from './Channels.module.css';

function confirmDeleteChannel(channelId: string) {
  const ch = useStore.getState().channels.find((c) => c.id === channelId);
  const displayName = ch?.name || channelId;
  const msg = window.t('channel.deleteConfirm', { name: displayName }) || '';
  if (!confirm(msg)) return;
  deleteChannel(channelId);
}

export function ChannelHeader() {
  const { t } = useI18n();
  const headerName = useStore(s => s.channelHeaderName);
  const headerMembers = useStore(s => s.channelHeaderMembersText);
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuItems, setMenuItems] = useState<ContextMenuItem[]>([]);

  const handleMenu = useCallback((e: React.MouseEvent) => {
    if (!currentChannel) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuItems([
      {
        label: t('channel.deleteChannel'),
        danger: true,
        action: () => confirmDeleteChannel(currentChannel),
      },
    ]);
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
  }, [currentChannel, t]);

  const handleCloseMenu = useCallback(() => {
    setMenuPos(null);
  }, []);

  return (
    <div className={styles.channelHeader}>
      <div className={styles.channelHeaderInfo}>
        <span className={styles.channelHeaderName}>{headerName}</span>
        <span className={styles.channelHeaderMembers}>{headerMembers}</span>
      </div>
      <div className={styles.channelHeaderActions}>
        {currentChannel && !isDM && (
          <button
            className={styles.channelHeaderActionBtn}
            title={t('common.more')}
            onClick={handleMenu}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
        )}
      </div>
      {menuPos && (
        <ContextMenu items={menuItems} position={menuPos} onClose={handleCloseMenu} />
      )}
    </div>
  );
}
