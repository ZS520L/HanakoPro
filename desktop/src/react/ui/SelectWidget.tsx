import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './SelectWidget.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface SelectWidgetProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  popupClassName?: string;
  renderTrigger?: (option: SelectOption | undefined, isOpen: boolean) => React.ReactNode;
  renderOption?: (option: SelectOption, isSelected: boolean) => React.ReactNode;
}

export function SelectWidget({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  popupClassName,
  renderTrigger,
  renderOption,
}: SelectWidgetProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;

    setPanelStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 2 }
        : { top: rect.bottom + 2 }),
      zIndex: 9999,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [open, close]);

  const current = options.find(o => o.value === value);
  const displayText = current?.label || placeholder || '';
  const isPlaceholder = !current;

  const renderItems = () => {
    const hasGroups = options.some(o => o.group);
    if (!hasGroups) {
      return options.map(item => renderItem(item));
    }

    const groups: Record<string, SelectOption[]> = {};
    for (const o of options) {
      const g = o.group || '';
      if (!groups[g]) groups[g] = [];
      groups[g].push(o);
    }

    return Object.entries(groups).map(([group, items]) => (
      <div key={group || '__none'}>
        {group && <div className={styles.groupHeader}>{group}</div>}
        {items.map(item => renderItem(item, group))}
      </div>
    ));
  };

  const renderItem = (item: SelectOption, group?: string) => {
    const selected = item.value === value;
    return (
      <button
        type="button"
        key={group ? `${group}/${item.value}` : item.value}
        role="option"
        aria-selected={selected}
        className={[
          styles.option,
          selected && styles.selected,
          item.disabled && styles.disabled,
        ].filter(Boolean).join(' ')}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          onChange(item.value);
          close();
        }}
      >
        {renderOption ? renderOption(item, selected) : item.label}
      </button>
    );
  };

  return (
    <div className={[styles.root, open && styles.open, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={[styles.trigger, triggerClassName].filter(Boolean).join(' ')}
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={displayText}
      >
        {renderTrigger ? renderTrigger(current, open) : (
          <>
            <span className={[styles.value, isPlaceholder && styles.placeholder].filter(Boolean).join(' ')}>
              {displayText}
            </span>
            <span className={styles.arrow}>▾</span>
          </>
        )}
      </button>
      {open && createPortal(
        <div
          className={[styles.popup, popupClassName].filter(Boolean).join(' ')}
          ref={panelRef}
          style={panelStyle}
          data-select-widget-popup
          role="listbox"
        >
          {renderItems()}
        </div>,
        document.body,
      )}
    </div>
  );
}
