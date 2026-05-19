import { useEffect, useRef, useState } from 'react';
import { splitGraphemes } from '../utils/grapheme';

export interface TypewriterTextOptions {
  active?: boolean;
  displayFps?: number;
  minBatch?: number;
  maxBatch?: number;
  catchUpThreshold?: number;
}

const DEFAULT_DISPLAY_FPS = 30;
const DEFAULT_MIN_BATCH = 1;
const DEFAULT_MAX_BATCH = 24;
const DEFAULT_CATCH_UP_THRESHOLD = 24;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function chooseBatchSize(
  backlog: number,
  minBatch: number,
  maxBatch: number,
  catchUpThreshold: number,
): number {
  if (backlog <= 0) return 0;
  if (backlog <= 12) return minBatch;
  if (backlog <= catchUpThreshold) return Math.min(maxBatch, Math.max(minBatch, 2));
  if (backlog <= catchUpThreshold * 2) {
    return Math.min(maxBatch, Math.max(4, Math.ceil(backlog / 12)));
  }
  return Math.min(maxBatch, Math.max(8, Math.ceil(backlog / 8)));
}

export function useTypewriterText(target: string, options: TypewriterTextOptions = {}): string {
  const {
    active = true,
    displayFps = DEFAULT_DISPLAY_FPS,
    minBatch = DEFAULT_MIN_BATCH,
    maxBatch = DEFAULT_MAX_BATCH,
    catchUpThreshold = DEFAULT_CATCH_UP_THRESHOLD,
  } = options;

  const [visible, setVisible] = useState(target);
  const visibleRef = useRef(target);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const lastAdvanceTimeRef = useRef<number | null>(null);
  const configRef = useRef({ active, displayFps, minBatch, maxBatch, catchUpThreshold });

  configRef.current = { active, displayFps, minBatch, maxBatch, catchUpThreshold };
  targetRef.current = target;

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const setFullTarget = () => {
      cancel();
      lastAdvanceTimeRef.current = null;
      visibleRef.current = targetRef.current;
      setVisible(targetRef.current);
    };

    const advance = (timestamp: number) => {
      rafRef.current = null;
      const config = configRef.current;
      const current = visibleRef.current;
      const nextTarget = targetRef.current;

      if (!config.active || prefersReducedMotion()) {
        setFullTarget();
        return;
      }
      if (current === nextTarget) {
        lastAdvanceTimeRef.current = null;
        return;
      }
      if (!nextTarget.startsWith(current)) {
        setFullTarget();
        return;
      }

      const intervalMs = 1000 / Math.max(1, config.displayFps);
      const lastAdvanceTime = lastAdvanceTimeRef.current;
      if (lastAdvanceTime == null || timestamp - lastAdvanceTime >= intervalMs) {
        lastAdvanceTimeRef.current = timestamp;
        const remaining = nextTarget.slice(current.length);
        const remainingSegments = splitGraphemes(remaining);
        const batchSize = chooseBatchSize(
          remainingSegments.length,
          config.minBatch,
          config.maxBatch,
          config.catchUpThreshold,
        );
        const nextVisible = current + remainingSegments.slice(0, batchSize).join('');
        visibleRef.current = nextVisible;
        setVisible(nextVisible);
      }

      if (visibleRef.current !== targetRef.current && rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(advance);
      }
    };

    const current = visibleRef.current;
    if (!active || prefersReducedMotion()) {
      setFullTarget();
      return cancel;
    }
    if (target === current) return cancel;
    if (!target.startsWith(current)) {
      setFullTarget();
      return cancel;
    }
    if (rafRef.current == null) {
      rafRef.current = window.requestAnimationFrame(advance);
    }
    return cancel;
  }, [active, target]);

  return visible;
}
