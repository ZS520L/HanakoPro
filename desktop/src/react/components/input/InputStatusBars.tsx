import { memo } from 'react';
import styles from './InputArea.module.css';

interface Props {
  slashBusy: string | null;
  slashBusyLabel: string;
  compacting: boolean;
  compactingLabel: string;
  screenshotBusy: boolean;
  screenshotLabel: string;
  screenshotPageLabel?: string | null;
  screenshotProgress?: {
    completedBlocks: number;
    totalBlocks: number;
    currentPage: number;
    totalPages: number;
  } | null;
  inlineError: string | null;
  slashResult: { text: string; type: 'success' | 'error'; deskDir?: string } | null;
  onResultClick: (() => void) | undefined;
}

/** 输入区域上方的状态提示条（slash 执行中 / 压缩中 / 错误 / 结果） */
export const InputStatusBars = memo(function InputStatusBars({
  slashBusy, slashBusyLabel, compacting, compactingLabel,
  screenshotBusy, screenshotLabel, screenshotPageLabel, screenshotProgress,
  inlineError, slashResult, onResultClick,
}: Props) {
  const completedBlocks = screenshotProgress?.completedBlocks ?? 0;
  const totalBlocks = screenshotProgress?.totalBlocks ?? 0;
  const percent = totalBlocks > 0
    ? Math.min(100, Math.max(0, (completedBlocks / totalBlocks) * 100))
    : 0;
  const progressLabel = screenshotPageLabel || screenshotLabel;

  return (
    <>
      {slashBusy && (
        <div className={styles['slash-busy-bar']}>
          <span className={styles['slash-busy-dot']} />
          <span>{slashBusyLabel}</span>
        </div>
      )}
      {compacting && (
        <div className={styles['slash-busy-bar']}>
          <span className={styles['slash-busy-dot']} />
          <span>{compactingLabel}</span>
        </div>
      )}
      {screenshotBusy && (
        <div className={`${styles['slash-busy-bar']} ${styles['screenshot-busy-bar']}`}>
          <div className={styles['screenshot-busy-label']}>
            <span className={styles['slash-busy-dot']} />
            <span>{progressLabel}</span>
          </div>
          <div
            className={styles['screenshot-progress-track']}
            role="progressbar"
            aria-label={progressLabel}
            aria-valuemin={0}
            aria-valuemax={totalBlocks || 1}
            aria-valuenow={Math.min(completedBlocks, totalBlocks || completedBlocks)}
          >
            <span
              className={styles['screenshot-progress-fill']}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}
      {inlineError && (
        <div className={styles['slash-error-bar']}>
          <span className={styles['slash-error-dot']} />
          <span>{inlineError}</span>
        </div>
      )}
      {!slashBusy && !compacting && !screenshotBusy && !inlineError && slashResult && (
        <div
          className={`${styles['slash-busy-bar']}${slashResult.deskDir ? ` ${styles['slash-busy-bar-clickable']}` : ''}`}
          onClick={onResultClick}
          role={slashResult.deskDir ? 'button' : undefined}
        >
          <span className={styles[slashResult.type === 'success' ? 'slash-result-dot-ok' : 'slash-result-dot-err']} />
          <span>{slashResult.text}</span>
        </div>
      )}
    </>
  );
});
