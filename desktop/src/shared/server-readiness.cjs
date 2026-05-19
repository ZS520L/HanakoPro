/**
 * server-readiness.cjs — Server 启动前的文件就绪性校验
 *
 * 自动更新（Windows NSIS overlay + Defender 扫描锁）会让新版本文件落地有几秒到
 * 几分钟延迟。本模块在 spawn server 前先做退避检查，把"自动更新刚完成新文件还没
 * 写完"和"打包真的少装了包"区分开。
 *
 * ⚠️ 扩展名必须是 .cjs：根 package.json 有 "type": "module"，.js 会被 Node
 * 当成 ESM，module.exports 失效。同 path-to-file-url.cjs / auto-updater.cjs。
 *
 * 关键文件 + external 包列表与打包入口、vite.config.server.js 的 external 字段同步维护：
 * 那边的 string 类型 external 在 build-server.mjs 构建期已强制校验装入
 * server/node_modules，运行时这里只挑最关键的几个做"文件竞态"判定。
 * 维护原则：宁可少列，不要多列。误判"少包"会让用户白白多等几秒。
 */
const fs = require("fs");
const path = require("path");

const CRITICAL_BUNDLED_EXTERNALS = [
  "ws",              // WebSocket，server 启动期立刻 import
  "better-sqlite3",  // SQLite native addon
  "qrcode",          // QR 渲染
];

const CRITICAL_BUNDLED_FILES = [
  "bootstrap.js",    // 第一条可观测启动日志，必须早于 bundle import
  "bundle/index.js",
];

const DEFAULT_BACKOFF_MS = [200, 500, 1000, 2000, 4000, 8000];
// 启动期望窗口。bundle 越打越大，Windows + Defender 实时扫描每个被 require 的
// 文件让 cold start 经常突破 60s（#719 / #736），90s 给一次合理 buffer。
const SERVER_INFO_FIRST_WAIT_MS = 90_000;
// 超过 first deadline 后，看到任何 stdout 进度就再延这么久。bootstrap.js 用
// worker_threads 跑独立 keepalive（5s 周期），即使主线程被 import 阻塞也能持续
// 出信号，180s 是稳健的安全网。
const SERVER_INFO_PROGRESS_GRACE_MS = 180_000;
const SERVER_INFO_MAX_WAIT_MS = 5 * 60_000;

/**
 * 校验打包模式下 server/node_modules/ 中关键 external 包是否齐全。
 * 退避重试覆盖大多数 NSIS + Defender 场景；超过约 16s 仍缺失则当作真缺包，
 * 上抛让用户看到"自动更新未落地"的友好错误。
 *
 * @param {string} serverRoot - 打包 server 根目录（含 node_modules/）
 * @param {object} [opts]
 * @param {number[]} [opts.backoffMs] - 退避序列，默认 [200,500,1000,2000,4000,8000]
 * @param {(ms: number) => Promise<void>} [opts.sleep] - 用于测试注入
 * @param {(missing: string[]) => void} [opts.onRetry] - 用于测试观察重试
 * @returns {Promise<{ok: true} | {ok: false, missing: string[], waitedMs: number}>}
 */
async function ensureServerFilesReady(serverRoot, opts = {}) {
  const backoffMs = opts.backoffMs || DEFAULT_BACKOFF_MS;
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const start = Date.now();

  const checkOnce = () => {
    const missing = [];
    for (const file of CRITICAL_BUNDLED_FILES) {
      const filePath = path.join(serverRoot, ...file.split("/"));
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch {
        missing.push(file);
      }
    }
    for (const pkg of CRITICAL_BUNDLED_EXTERNALS) {
      const pkgJson = path.join(serverRoot, "node_modules", pkg, "package.json");
      try {
        fs.accessSync(pkgJson, fs.constants.R_OK);
      } catch {
        missing.push(`node_modules/${pkg}/package.json`);
      }
    }
    return missing;
  };

  let missing = checkOnce();
  if (missing.length === 0) return { ok: true };

  if (opts.onRetry) opts.onRetry(missing);
  for (const wait of backoffMs) {
    await sleep(wait);
    missing = checkOnce();
    if (missing.length === 0) {
      return { ok: true };
    }
  }
  return { ok: false, missing, waitedMs: Date.now() - start };
}

/**
 * 判断 server 启动期的 stderr 日志是否疑似"模块解析失败"，并返回缺失的模块名。
 * Node 的 ERR_MODULE_NOT_FOUND 错误文案稳定，覆盖 ESM `import 'X'` 和
 * CJS `require('X')` 两种形态。
 *
 * @param {string[]} stderrLogs - 收集的 stderr 行
 * @returns {string | null} 缺失的模块名；非模块解析错误返回 null
 */
function isModuleResolutionError(stderrLogs) {
  if (!Array.isArray(stderrLogs) || stderrLogs.length === 0) return null;
  const joined = stderrLogs.join("");
  const match = joined.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/);
  if (match) return match[1];
  if (joined.includes("ERR_MODULE_NOT_FOUND")) return "unknown-module";
  return null;
}

/**
 * Server readiness has two clocks:
 * - firstDeadlineMs: the normal fast-path deadline.
 * - maxWaitMs/progressGraceMs: the slow-start guard for Windows update/cold-start cases.
 *
 * After the first deadline, a live child may keep initializing only if it has
 * produced recent output. This keeps slow imports from being misreported as a
 * launch failure while still bounding truly stuck processes.
 */
function shouldKeepWaitingForServerInfo({
  nowMs,
  startedAtMs,
  firstDeadlineMs,
  lastProgressAtMs,
  childAlive,
  progressGraceMs = SERVER_INFO_PROGRESS_GRACE_MS,
  maxWaitMs = SERVER_INFO_MAX_WAIT_MS,
}) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(startedAtMs) || !Number.isFinite(firstDeadlineMs)) {
    return false;
  }
  if (nowMs <= firstDeadlineMs) return true;
  if (!childAlive) return false;
  if (nowMs - startedAtMs >= maxWaitMs) return false;
  if (!Number.isFinite(lastProgressAtMs)) return false;
  return nowMs - lastProgressAtMs <= progressGraceMs;
}

module.exports = {
  CRITICAL_BUNDLED_FILES,
  CRITICAL_BUNDLED_EXTERNALS,
  SERVER_INFO_FIRST_WAIT_MS,
  SERVER_INFO_PROGRESS_GRACE_MS,
  SERVER_INFO_MAX_WAIT_MS,
  ensureServerFilesReady,
  isModuleResolutionError,
  shouldKeepWaitingForServerInfo,
};
