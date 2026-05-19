import { useEffect, useRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import { useAnimatePresence, type AnimateStage } from '../hooks/use-animate-presence';
import styles from './Overlay.module.css';

type BackdropVariant = 'dim' | 'blur' | 'none';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  backdrop?: BackdropVariant;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  trapFocus?: boolean;
  zIndex?: number;
  /** 应用到内容容器的 class。不提供时使用默认卡片外观 */
  className?: string;
  backdropClassName?: string;
  duration?: number;
  /** 禁用 Overlay 默认的容器进出动画（hana-scale-in / hana-fade-down），让 className 自带的动画接管。 */
  disableContainerAnimation?: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function stageClass(stage: AnimateStage, enter: string, exit: string) {
  if (stage === 'enter') return enter;
  if (stage === 'exit') return exit;
  return '';
}

export function Overlay({
  open,
  onClose,
  children,
  backdrop = 'dim',
  closeOnEsc = true,
  closeOnBackdrop = true,
  trapFocus = true,
  zIndex = 1000,
  className,
  backdropClassName,
  duration = 250,
  disableContainerAnimation = false,
}: OverlayProps) {
  const { mounted, stage } = useAnimatePresence(open, { duration });
  const backdropRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!mounted || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mounted, closeOnEsc, onClose]);

  useEffect(() => {
    if (mounted) {
      returnFocusRef.current = document.activeElement;
    } else if (returnFocusRef.current instanceof HTMLElement) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [mounted]);

  useEffect(() => {
    if (stage !== 'idle') return;
    if (!trapFocus) return;
    const el = backdropRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [stage, trapFocus]);

  useEffect(() => {
    if (!mounted || !trapFocus) return;
    const el = backdropRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mounted, trapFocus]);

  const handleBackdropClick = useCallback((e: MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  }, [closeOnBackdrop, onClose]);

  if (!mounted) return null;

  const backdropCls = [
    styles.backdrop,
    backdrop === 'dim' && styles['backdrop-dim'],
    backdrop === 'blur' && styles['backdrop-blur'],
    stageClass(stage, styles.enter, styles.exit),
    backdropClassName,
  ].filter(Boolean).join(' ');

  const containerCls = [
    styles.container,
    !disableContainerAnimation && stageClass(stage, styles['container-enter'], styles['container-exit']),
    className || styles.card,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={backdropRef}
      className={backdropCls}
      style={{ zIndex }}
      onMouseDown={handleBackdropClick}
    >
      <div className={containerCls}>
        {children}
      </div>
    </div>
  );
}
