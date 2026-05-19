import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  computeFloatingInputPosition,
  type FloatingInputOrigin,
  type FloatingRect,
} from './position';
import styles from './FloatingInput.module.css';

const CLOSE_DURATION_MS = 150;
const FALLBACK_HEIGHT = 56;
const FLOATING_INPUT_WIDTH_RATIO = 2 / 9;

interface ViewportSize {
  width: number;
  height: number;
}

interface FloatingInputProps {
  open: boolean;
  anchorRect: FloatingRect | null | undefined;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  onClose?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  submitLabel?: string;
}

function getViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 0, height: 0 };
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

export function FloatingInput({
  open,
  anchorRect,
  value,
  onChange,
  onSubmit,
  onClose,
  disabled = false,
  autoFocus = true,
  placeholder = '',
  ariaLabel = 'Floating input',
  submitLabel = 'Send',
}: FloatingInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const [rendered, setRendered] = useState(open && !!anchorRect);
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>(open ? 'open' : 'closing');
  const [viewport, setViewport] = useState<ViewportSize>(() => getViewportSize());
  const [floatingHeight, setFloatingHeight] = useState(FALLBACK_HEIGHT);

  useEffect(() => {
    const handleResize = () => setViewport(getViewportSize());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (open && anchorRect) {
      setRendered(true);
      setPhase('opening');
      openFrameRef.current = window.requestAnimationFrame(() => {
        setPhase('open');
        openFrameRef.current = null;
      });
      return;
    }

    if (!rendered) return;
    setPhase('closing');
    closeTimerRef.current = window.setTimeout(() => {
      setRendered(false);
      closeTimerRef.current = null;
    }, CLOSE_DURATION_MS);
  }, [anchorRect, open, rendered]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!rendered || phase !== 'open' || !autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus, phase, rendered]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 24)}px`;
    setFloatingHeight(rootRef.current?.getBoundingClientRect().height || FALLBACK_HEIGHT);
  }, [value, rendered]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setFloatingHeight(entry.contentRect.height || FALLBACK_HEIGHT);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rendered]);

  const position = useMemo(() => {
    if (!anchorRect || viewport.width <= 0 || viewport.height <= 0) return null;
    return computeFloatingInputPosition(anchorRect, viewport, {
      width: viewport.width * FLOATING_INPUT_WIDTH_RATIO,
      height: floatingHeight,
    });
  }, [anchorRect, floatingHeight, viewport]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    void onSubmit(text);
  }, [disabled, onSubmit, value]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || isComposingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }, [onClose, submit]);

  if (!rendered || !position) return null;

  const className = [
    styles['floating-input'],
    phase === 'open' ? styles['floating-input-open'] : '',
    phase === 'closing' ? styles['floating-input-closing'] : '',
  ].filter(Boolean).join(' ');
  const origin: FloatingInputOrigin = position.origin;

  return (
    <div
      ref={rootRef}
      className={className}
      data-origin={origin}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <form
        className={styles['floating-input-form']}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          className={styles['floating-input-box']}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
        />
        <button
          type="submit"
          className={styles['floating-input-submit']}
          aria-label={submitLabel}
          title={submitLabel}
          disabled={disabled || value.trim().length === 0}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        </button>
      </form>
    </div>
  );
}
