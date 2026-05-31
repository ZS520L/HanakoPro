import { Component, type ReactNode } from 'react';
import styles from './RegionalErrorBoundary.module.css';

declare function t(key: string, vars?: Record<string, string | number>): string;

interface Props {
  region: string;
  resetKeys?: unknown[];
  children: ReactNode;
}

interface State {
  error: Error | null;
  prevResetKeys: unknown[];
}

const AUTO_RETRY_DELAYS = [300, 800, 1500, 3000];

export class RegionalErrorBoundary extends Component<Props, State> {
  state: State = { error: null, prevResetKeys: this.props.resetKeys || [] };
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _retryCount = 0;

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKeys && state.error) {
      const changed = props.resetKeys.some((k, i) => k !== state.prevResetKeys[i]);
      if (changed) return { error: null, prevResetKeys: props.resetKeys };
    }
    if (props.resetKeys) return { prevResetKeys: props.resetKeys };
    return null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[RegionalErrorBoundary:${this.props.region}]`, error, info.componentStack?.slice(0, 200));

    // 自动重试：启动后短时间内子组件常因 server 未就绪抛错
    // 递增延迟重试，避免无限循环
    this._scheduleAutoRetry();

    // 错误上报（best effort）
    try {
      import('../../../../shared/error-bus.js').then(({ errorBus }: { errorBus: { report: (e: unknown, opts?: unknown) => void } }) => {
        import('../../../../shared/errors.js').then(({ AppError }: { AppError: new (code: string, opts?: Record<string, unknown>) => Error }) => {
          errorBus.report(new AppError('RENDER_CRASH', {
            cause: error,
            context: { region: this.props.region, componentStack: info.componentStack?.slice(0, 500) },
          }));
        });
      }).catch(() => {});
    } catch { /* best effort */ }
  }

  componentWillUnmount() {
    this._clearRetryTimer();
  }

  private _clearRetryTimer() {
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  }

  private _scheduleAutoRetry() {
    this._clearRetryTimer();
    const delay = AUTO_RETRY_DELAYS[Math.min(this._retryCount, AUTO_RETRY_DELAYS.length - 1)];
    this._retryCount++;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.setState({ error: null });
    }, delay);
  }

  handleRetry = () => {
    this._clearRetryTimer();
    this._retryCount = 0;
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className={styles.fallback}>
          <p className={styles.message}>{t('error.regionUnavailable')}</p>
          <p className={styles.retryHint}>
            {t('error.autoRetry')}
          </p>
          <button className={styles.retry} onClick={this.handleRetry}>
            {t('action.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
