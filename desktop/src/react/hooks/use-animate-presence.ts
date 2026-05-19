import { useState, useEffect, useRef, useCallback } from 'react';

export type AnimateStage = 'enter' | 'idle' | 'exit';

interface Options {
  duration?: number;
}

const DEFAULT_DURATION = 250;  // 对齐 --duration-slow（0.25s）

/**
 * 管理"先播退出动画、再 unmount"的生命周期。
 *
 * @param visible  外部控制的可见性
 * @param options  duration: 退出动画时长 (ms)，到期后 mounted 变为 false
 * @returns mounted  动画结束前保持 true
 * @returns stage   'enter' | 'idle' | 'exit'
 *
 * 用法：
 *   const { mounted, stage } = useAnimatePresence(open, { duration: 250 });
 *   if (!mounted) return null;
 *   return <div className={stage === 'enter' ? 'hana-fade-in' : stage === 'exit' ? 'hana-fade-out' : ''}>
 */
export function useAnimatePresence(visible: boolean, options?: Options) {
  const duration = options?.duration ?? DEFAULT_DURATION;
  const [mounted, setMounted] = useState(visible);
  const [stage, setStage] = useState<AnimateStage>(visible ? 'idle' : 'exit');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);

    if (visible) {
      setMounted(true);
      setStage('enter');
      timerRef.current = setTimeout(() => setStage('idle'), duration);
    } else if (mounted) {
      setStage('exit');
      timerRef.current = setTimeout(() => setMounted(false), duration);
    }

    return () => clearTimeout(timerRef.current);
  }, [visible]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onAnimationEnd = useCallback(() => {
    if (!visible) setMounted(false);
    else setStage('idle');
  }, [visible]);

  return { mounted, stage, onAnimationEnd } as const;
}
