import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import type { SessionConfirmationBlock } from '../../stores/chat-types';
import styles from './InputArea.module.css';

type ConfirmationAction = 'confirmed' | 'rejected';

function textWithFallback(key: string, fallback: string) {
  const translated = window.t?.(key);
  return translated && translated !== key ? translated : fallback;
}

interface SessionConfirmationPromptProps {
  block: SessionConfirmationBlock;
  exiting?: boolean;
}

function displayTitle(block: SessionConfirmationBlock) {
  if (block.kind === 'computer_app_approval') {
    const appName = block.subject?.label || '这个应用';
    return `是否允许 Hana 控制 ${appName}`;
  }
  return block.title;
}

function displaySubject(block: SessionConfirmationBlock) {
  if (block.kind === 'computer_app_approval') {
    return {
      label: 'computer app',
      detail: block.subject?.detail || block.subject?.label || '',
    };
  }
  if (block.subject?.label || block.subject?.detail) {
    return {
      label: block.subject?.label || '',
      detail: block.subject?.detail || '',
    };
  }
  return {
    label: block.body || '',
    detail: '',
  };
}

function stringifyTooltipValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatParamsTooltip(params: unknown): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return stringifyTooltipValue(params);
  }
  const readable = Object.entries(params as Record<string, unknown>)
    .map(([key, value]) => {
      const text = stringifyTooltipValue(value);
      return text ? `${key}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const json = stringifyTooltipValue(params);
  if (!readable) return json;
  return readable === json ? readable : `${readable}\n\n${json}`;
}

function buildTooltipText(
  block: SessionConfirmationBlock,
  title: string,
  subject: { label: string; detail: string },
) {
  const lines: string[] = [];
  if (title) lines.push(title);
  const subjectLine = [subject.label, subject.detail].filter(Boolean).join(': ');
  if (subjectLine) lines.push(subjectLine);

  const params = block.payload?.params;
  const paramsText = formatParamsTooltip(params);
  if (paramsText) {
    lines.push(paramsText);
  } else if (block.body) {
    lines.push(block.body);
  }

  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean))).join('\n\n');
}

export function SessionConfirmationPrompt({ block, exiting = false }: SessionConfirmationPromptProps) {
  const [submission, setSubmission] = useState<{ confirmId: string; action: ConfirmationAction } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const [switchingMode, setSwitchingMode] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const tooltipAnchorRef = useRef<HTMLDivElement>(null);
  const tooltipPanelRef = useRef<HTMLDivElement>(null);
  const pending = block.status === 'pending' && !exiting;
  const submitting = submission?.confirmId === block.confirmId ? submission.action : null;
  const confirmLabel = block.actions?.confirmLabel || window.t?.('common.approve') || '同意';
  const rejectLabel = block.actions?.rejectLabel || window.t?.('common.reject') || '拒绝';
  const title = displayTitle(block);
  const subject = displaySubject(block);
  const hasSubject = !!(subject.label || subject.detail);
  const tooltipText = useMemo(() => buildTooltipText(block, title, subject), [block, subject, title]);
  const tooltipId = `session-confirmation-tooltip-${block.confirmId}`;
  const canDisableAskForConversation = block.kind === 'tool_action_approval';
  const busy = !!submitting || switchingMode;

  const updateMenuPosition = useCallback(() => {
    const anchor = menuAnchorRef.current;
    if (!menuOpen || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = menuPanelRef.current?.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const panelWidth = panelRect?.width || 160;
    const panelHeight = panelRect?.height || 36;

    const left = Math.max(
      viewportPadding,
      Math.min(anchorRect.right - panelWidth, window.innerWidth - panelWidth - viewportPadding),
    );
    const preferredTop = anchorRect.top - panelHeight - gap;
    const fallbackTop = Math.min(
      window.innerHeight - panelHeight - viewportPadding,
      anchorRect.bottom + gap,
    );
    const top = Math.max(viewportPadding, preferredTop < viewportPadding ? fallbackTop : preferredTop);

    setMenuStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 10000,
    });
  }, [menuOpen]);

  const updateTooltipPosition = useCallback(() => {
    const anchor = tooltipAnchorRef.current;
    if (!tooltipOpen || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = tooltipPanelRef.current?.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 8;
    const panelWidth = panelRect?.width || Math.min(520, window.innerWidth - viewportPadding * 2);
    const panelHeight = panelRect?.height || 120;
    const left = Math.max(
      viewportPadding,
      Math.min(anchorRect.left, window.innerWidth - panelWidth - viewportPadding),
    );
    const preferredTop = anchorRect.top - panelHeight - gap;
    const fallbackTop = anchorRect.bottom + gap;
    const top = Math.max(
      viewportPadding,
      preferredTop < viewportPadding
        ? Math.min(fallbackTop, window.innerHeight - panelHeight - viewportPadding)
        : preferredTop,
    );

    setTooltipStyle({
      position: 'fixed',
      top,
      left,
      zIndex: 10001,
    });
  }, [tooltipOpen]);

  useLayoutEffect(() => {
    updateMenuPosition();
  }, [updateMenuPosition]);

  useLayoutEffect(() => {
    updateTooltipPosition();
  }, [updateTooltipPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!tooltipOpen) return;
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [tooltipOpen, updateTooltipPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuAnchorRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
    setTooltipOpen(false);
  }, [block.confirmId]);

  const submit = useCallback(async (action: ConfirmationAction) => {
    if (!pending || submitting) return;
    setMenuOpen(false);
    setSubmission({ confirmId: block.confirmId, action });
    try {
      await hanaFetch(`/api/confirm/${block.confirmId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch (err) {
      setSubmission((current) => (
        current?.confirmId === block.confirmId ? null : current
      ));
      console.warn('[session-confirmation] submit failed', err);
    }
  }, [block.confirmId, pending, submitting]);

  const disableAskForConversation = useCallback(async () => {
    if (!pending || submitting || switchingMode || !canDisableAskForConversation) return;
    setMenuOpen(false);
    setSwitchingMode(true);
    try {
      const res = await hanaFetch('/api/session-permission-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'operate', currentSessionOnly: true }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'failed to switch current session permission mode');
      }
      window.dispatchEvent(new CustomEvent('hana-plan-mode', {
        detail: { enabled: false, mode: data?.mode || 'operate' },
      }));
      await submit('confirmed');
    } catch (err) {
      window.dispatchEvent(new CustomEvent('hana-inline-notice', {
        detail: {
          text: textWithFallback('input.accessModeLocked', '当前无法更改权限模式'),
          type: 'error',
        },
      }));
      console.warn('[session-confirmation] disable ask for conversation failed', err);
    } finally {
      setSwitchingMode(false);
    }
  }, [canDisableAskForConversation, pending, submit, submitting, switchingMode]);

  const menu = menuOpen && typeof document !== 'undefined'
    ? createPortal(
      <div
        className={styles['session-confirmation-menu']}
        ref={menuPanelRef}
        role="menu"
        style={menuStyle}
      >
        <button
          type="button"
          role="menuitem"
          className={styles['session-confirmation-menu-item']}
          onClick={disableAskForConversation}
        >
          {textWithFallback('input.noAskThisConversation', '本对话不再询问')}
        </button>
      </div>,
      document.body,
    )
    : null;

  const tooltip = tooltipOpen && tooltipText && typeof document !== 'undefined'
    ? createPortal(
      <div
        id={tooltipId}
        className={styles['session-confirmation-tooltip']}
        ref={tooltipPanelRef}
        role="tooltip"
        style={tooltipStyle}
      >
        {tooltipText}
      </div>,
      document.body,
    )
    : null;

  return (
    <div
      className={`${styles['session-confirmation-prompt']} ${exiting ? styles['session-confirmation-prompt-exiting'] : ''}`}
      data-confirm-id={block.confirmId}
      data-status={block.status}
      data-severity={block.severity || 'normal'}
    >
      <div
        className={styles['session-confirmation-body']}
        ref={tooltipAnchorRef}
        data-testid="session-confirmation-summary"
        tabIndex={0}
        aria-describedby={tooltipOpen && tooltipText ? tooltipId : undefined}
        onMouseEnter={() => tooltipText && setTooltipOpen(true)}
        onMouseLeave={() => setTooltipOpen(false)}
        onFocus={() => tooltipText && setTooltipOpen(true)}
        onBlur={() => setTooltipOpen(false)}
      >
        <div className={styles['session-confirmation-title']}>{title}</div>
        {hasSubject && (
          <div className={styles['session-confirmation-subject']}>
            {subject.label && <span className={styles['session-confirmation-subject-label']}>{subject.label}</span>}
            {subject.detail && <span className={styles['session-confirmation-subject-detail']}>{subject.detail}</span>}
          </div>
        )}
      </div>
      {pending ? (
        <div className={styles['session-confirmation-actions']}>
          <button
            type="button"
            className={`${styles['session-confirmation-button']} ${styles['session-confirmation-button-reject']}`}
            onClick={() => submit('rejected')}
            disabled={busy}
          >
            {rejectLabel}
          </button>
          {canDisableAskForConversation ? (
            <div className={styles['session-confirmation-confirm-wrap']} ref={menuAnchorRef}>
              <div className={styles['session-confirmation-split']}>
                <button
                  type="button"
                  className={`${styles['session-confirmation-button']} ${styles['session-confirmation-button-confirm']} ${styles['session-confirmation-split-main']}`}
                  onClick={() => submit('confirmed')}
                  disabled={busy}
                >
                  {confirmLabel}
                </button>
                <button
                  type="button"
                  className={`${styles['session-confirmation-button']} ${styles['session-confirmation-button-confirm']} ${styles['session-confirmation-menu-trigger']}`}
                  aria-label={textWithFallback('input.confirmMoreOptions', '更多确认选项')}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  disabled={busy}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
              {menu}
            </div>
          ) : (
            <button
              type="button"
              className={`${styles['session-confirmation-button']} ${styles['session-confirmation-button-confirm']}`}
              onClick={() => submit('confirmed')}
              disabled={busy}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      ) : (
        <div className={styles['session-confirmation-resolved']}>
          {block.status === 'confirmed'
            ? (window.t?.('common.approved') || '已同意')
            : (window.t?.('common.rejected') || '已拒绝')}
        </div>
      )}
      {tooltip}
    </div>
  );
}
