import { useStore } from '../stores';
import {
  appendConnectionAuth,
  buildConnectionUrl,
  hasServerConnection,
  requireServerConnection,
} from '../services/server-connection';

const DEFAULT_TIMEOUT = 30_000;

/**
 * 构建带认证的 Hana Server URL
 *
 * 若 server 连接尚未就绪（例如应用刚启动，store 中的 connection 尚未注入），
 * 返回原始 path 作为 fallback，避免在 React render 期间抛异常触发 ErrorBoundary。
 * 组件会在连接就绪后的下一次 render 中获得正确的完整 URL。
 */
export function hanaUrl(path: string): string {
  const state = useStore.getState();
  if (!hasServerConnection(state)) {
    // server 未就绪：返回相对路径，不会导致渲染崩溃
    // 图片等资源会走 onError fallback（头像回退到文字首字母）
    return path;
  }
  const connection = requireServerConnection(
    state,
    `hanaUrl ${path}: server connection not ready`,
  );
  return buildConnectionUrl(connection, path, { includeTokenQuery: true });
}

/**
 * 带认证的 fetch 封装
 * - 默认 30s 超时
 * - 自动校验 res.ok，非 2xx 抛错
 */
export async function hanaFetch(
  path: string,
  opts: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const connection = requireServerConnection(
    useStore.getState(),
    `hanaFetch ${path}: server connection not ready`,
  );
  const headers = appendConnectionAuth(connection, opts.headers);

  const { timeout = DEFAULT_TIMEOUT, signal: callerSignal, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(buildConnectionUrl(connection, path), {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`hanaFetch ${path}: ${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}
