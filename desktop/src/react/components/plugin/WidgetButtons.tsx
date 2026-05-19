/**
 * WidgetButtons — titlebar icons for plugin widgets.
 *
 * All widgets are visible by default. Right-click to hide; hidden widgets
 * go into a dropdown menu where they can be shown again.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../../stores';
import { resolvePluginTitle, resolvePluginIcon } from '../../utils/resolve-plugin-title';
import { openWidget, openDesk, hideWidget, showWidget } from '../../stores/plugin-ui-actions';
import { ContextMenu, type ContextMenuItem } from '../../ui';
import s from './WidgetButtons.module.css';

interface MenuState { items: ContextMenuItem[]; position: { x: number; y: number } }

export function WidgetButtons() {
  const widgets = useStore(st => st.pluginWidgets);
  const hiddenWidgets = useStore(st => st.hiddenWidgets);
  const jianView = useStore(st => st.jianView);
  const currentTab = useStore(st => st.currentTab);
  const locale = useStore(st => st.locale);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const handleContextVisible = useCallback((e: React.MouseEvent, pluginId: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      position: { x: e.clientX, y: e.clientY },
      items: [{ label: `隐藏「${title}」`, action: () => hideWidget(pluginId) }],
    });
  }, []);

  if (currentTab !== 'chat' || widgets.length === 0) return null;

  const visibleWidgets = widgets.filter(w => !hiddenWidgets.includes(w.pluginId));
  const hiddenWidgetList = widgets.filter(w => hiddenWidgets.includes(w.pluginId));

  return (
    <div className={s.container}>
      {/* Visible widgets: individual buttons, right-click to hide */}
      {visibleWidgets.map(w => {
        const icon = resolvePluginIcon(w.icon, w.title, locale);
        const title = resolvePluginTitle(w.title, locale, w.pluginId);
        const active = jianView === `widget:${w.pluginId}`;
        return (
          <button
            key={w.pluginId}
            className={`${s.btn}${active ? ` ${s.active}` : ''}`}
            title={title}
            onClick={() => active ? openDesk() : openWidget(w.pluginId)}
            onContextMenu={(e) => handleContextVisible(e, w.pluginId, title)}
            dangerouslySetInnerHTML={icon.type === 'svg' ? { __html: icon.content } : undefined}
          >
            {icon.type === 'text' ? icon.content : null}
          </button>
        );
      })}

      {/* Dropdown for hidden widgets — show button to restore */}
      {hiddenWidgetList.length > 0 && (
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button className={s.btn} title="已隐藏的插件" onClick={() => setDropdownOpen(!dropdownOpen)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {dropdownOpen && (
            <div className={s.dropdown}>
              {hiddenWidgetList.map(w => {
                const title = resolvePluginTitle(w.title, locale, w.pluginId);
                return (
                  <div key={w.pluginId} className={s.dropdownRow}>
                    <button className={s.dropdownItem}
                      onClick={() => { showWidget(w.pluginId); setDropdownOpen(false); }}>
                      {title}
                    </button>
                    <button
                      className={s.pinBtn}
                      title="显示"
                      onClick={(e) => { e.stopPropagation(); showWidget(w.pluginId); setDropdownOpen(false); }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Desk toggle */}
      <button
        className={`${s.btn}${jianView === 'desk' ? ` ${s.active}` : ''}`}
        title="工作空间"
        onClick={() => openDesk()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
        </svg>
      </button>

      <div className={s.divider} />

      {menu && <ContextMenu items={menu.items} position={menu.position} onClose={() => setMenu(null)} />}
    </div>
  );
}
