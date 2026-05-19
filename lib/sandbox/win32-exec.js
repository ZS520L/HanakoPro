/**
 * win32-exec.js — Windows 平台的 bash 执行函数
 *
 * Windows direct fallback 仍走 Pi SDK 兼容的 shell 执行路径；
 * 沙盒开启时由 createWin32Exec({ sandbox }) 通过 AppContainer helper 启动。
 * Pi SDK 默认实现的 detached: true 在 Windows 上会设 DETACHED_PROCESS 标志，
 * 导致 MSYS2/Git Bash 的 stdout/stderr pipe 可能收不到数据。
 *
 * 这个模块提供替代的 exec 函数，使用 spawnAndStream（已去掉 Windows detached）。
 * 返回值契约匹配 Pi SDK BashOperations.exec。
 *
 * Runtime 策略：
 *   1. 简单 git 命令直接走受控 git.exe，避免把 Git 能力绑在 Bash 上
 *   2. Windows 原生命令走 cmd.exe
 *   3. POSIX shell 命令走 bash/ash/sh 兼容层
 *
 * POSIX/Git runtime 优先使用打包进 resources/git 的 bundled PortableGit runtime。
 * 沙盒开启时找不到 bundled runtime 就 fail fast；沙盒关闭时才允许系统 Git Bash 兜底。
 */

import { existsSync } from "fs";
import path, { dirname, join, resolve } from "path";
import { spawnSync } from "child_process";
import { spawnAndStream } from "./exec-helper.js";
import { classifyWin32Command } from "./win32-command-router.js";
import { assertSafeWin32BashCommand } from "./win32-bash-guard.js";
import { buildWin32SandboxGrants } from "./win32-policy.js";
import {
  buildWin32SandboxHelperArgs,
  resolveWin32SandboxHelper,
  resourceSiblingDir,
} from "./win32-sandbox-helper.js";

// ── Shell 查找 ──

let _cachedShell = null; // { shell, args, label }

const PROBE_TOKEN = "__hana_probe_ok__";
const PYTHON_COMMANDS = new Set(["python", "python.exe", "python3", "python3.exe"]);
const NODE_COMMANDS = new Set(["node", "node.exe"]);

// 枚举 Windows 盘符 C-Z（A/B 是软盘遗留，不扫）。
// 用户可能把 Git/MSYS2/Cygwin 装在任意非 C 盘（如 D:\Git、E:\msys64），
// 硬编码只找 C:/D: 在非这两个盘的机器上会直接失去 fallback。
const DRIVE_LETTERS = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function isWin32PathLike(filePath) {
  return /^[a-z]:[\\/]|^\\\\/i.test(String(filePath || ""));
}

function joinRuntimePath(root, ...segments) {
  return isWin32PathLike(root) ? path.win32.join(root, ...segments) : join(root, ...segments);
}

function dirnameRuntimePath(filePath) {
  return isWin32PathLike(filePath) ? path.win32.dirname(filePath) : dirname(filePath);
}

function basenameRuntimePath(filePath) {
  return isWin32PathLike(filePath) ? path.win32.basename(filePath) : path.basename(filePath);
}

function resolveRuntimePath(root, target) {
  return isWin32PathLike(root) || isWin32PathLike(target)
    ? path.win32.resolve(root || "", target)
    : resolve(root || "", target);
}

function normalizeRuntimePathForCompare(target) {
  const raw = String(target || "");
  return (isWin32PathLike(raw) ? path.win32.normalize(raw) : path.resolve(raw)).toLowerCase();
}

function runtimePathsEqual(a, b) {
  return normalizeRuntimePathForCompare(a) === normalizeRuntimePathForCompare(b);
}

function isInsideRuntimeRoot(target, root) {
  if (!target || !root) return false;
  const winPath = isWin32PathLike(target) || isWin32PathLike(root);
  const targetNorm = normalizeRuntimePathForCompare(target);
  const rootNorm = normalizeRuntimePathForCompare(root);
  const rel = winPath ? path.win32.relative(rootNorm, targetNorm) : path.relative(rootNorm, targetNorm);
  const isAbs = winPath ? path.win32.isAbsolute(rel) : path.isAbsolute(rel);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbs);
}

function pushUniqueRuntimePath(list, item) {
  if (!item) return;
  const key = String(item).toLowerCase();
  if (list.some(existing => String(existing).toLowerCase() === key)) return;
  list.push(item);
}

function getBundledGitRoots(env = process.env, deps = {}) {
  const resourcesPath = deps.resourcesPath !== undefined ? deps.resourcesPath : process.resourcesPath;
  const resolveResourceSibling = deps.resourceSiblingDir || ((name, options) => resourceSiblingDir(name, options));
  const roots = [
    resourcesPath ? joinRuntimePath(resourcesPath, "git") : null,
    env.HANA_ROOT ? resolve(env.HANA_ROOT, "..", "git") : null,
    resolveResourceSibling("git", { env }),
  ].filter(Boolean);

  const found = [];
  for (const root of roots) {
    pushUniqueRuntimePath(found, root);
  }
  return found;
}

/**
 * 对候选 shell 做 probe：用 spawnSync 跑 echo，确认 shell 可正常启动
 */
function probeShell(shell, args) {
  try {
    const result = spawnSync(shell, [...args, `echo ${PROBE_TOKEN}`], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = (result.stdout || "").trim();
    // 检查 exit code + stdout 有实际输出 + 包含 probe token
    // 避免 shell 启动成功但 stdout pipe 失效（Windows detached 进程常见问题）
    return result.status === 0 && stdout.length > 0 && stdout.includes(PROBE_TOKEN);
  } catch {
    return false;
  }
}

/**
 * 收集所有磁盘上存在的 shell 候选（不缓存、不 probe）
 *
 * 只收集 bash 兼容 shell（PI SDK 生成 POSIX shell 命令，PowerShell 语法不兼容）。
 *
 * 查找顺序：
 * 1. 系统 Git Bash（标准 + 常见安装位置）
 * 2. 注册表查询 Git 安装路径
 * 3. 内嵌 PortableGit 的 POSIX runtime（打包进 resources/git/）
 * 4. PATH 上的 bash.exe / sh.exe
 * 5. MSYS2 / Cygwin
 */
function getBundledShellCandidates(env = process.env, deps = {}) {
  const exists = deps.exists || existsSync;
  const found = [];
  const gitRoots = getBundledGitRoots(env, deps);
  for (const gitRoot of gitRoots) {
    const shellCandidates = [
      { relative: ["bin", "bash.exe"], args: ["-lc"], label: "PortableGit bash.exe" },
      { relative: ["usr", "bin", "bash.exe"], args: ["-lc"], label: "PortableGit usr/bin/bash.exe" },
      { relative: ["mingw64", "bin", "bash.exe"], args: ["-lc"], label: "PortableGit mingw64/bin/bash.exe" },
      { relative: ["mingw64", "bin", "sh.exe"], args: ["-c"], label: "PortableGit sh.exe" },
      { relative: ["mingw64", "bin", "ash.exe"], args: ["-c"], label: "Legacy MinGit ash.exe" },
      { relative: ["mingw64", "bin", "busybox.exe"], args: ["sh", "-c"], label: "Legacy MinGit busybox.exe" },
    ];
    for (const candidate of shellCandidates) {
      const shell = joinRuntimePath(gitRoot, ...candidate.relative);
      if (exists(shell) && !found.some(c => c.shell === shell)) {
        found.push({
          shell,
          args: candidate.args,
          label: `Bundled ${candidate.label} (${shell})`,
          bundledRoot: gitRoot,
        });
      }
    }
  }
  return found;
}

function getBundledGitCandidates(env = process.env, deps = {}) {
  const exists = deps.exists || existsSync;
  const found = [];
  for (const gitRoot of getBundledGitRoots(env, deps)) {
    for (const relative of [
      ["cmd", "git.exe"],
      ["mingw64", "bin", "git.exe"],
    ]) {
      const git = joinRuntimePath(gitRoot, ...relative);
      if (exists(git) && !found.some(c => c.git === git)) {
        found.push({
          git,
          label: `Bundled PortableGit git.exe (${git})`,
          bundledRoot: gitRoot,
        });
      }
    }
  }
  return found;
}

function getAllGitCandidates({ bundledOnly = false, env = process.env } = {}) {
  const found = [...getBundledGitCandidates(env)];
  if (bundledOnly) return found;

  const addIfExists = (git, label) => {
    if (!git || !existsSync(git)) return;
    if (found.some(c => String(c.git).toLowerCase() === String(git).toLowerCase())) return;
    found.push({ git, label });
  };

  try {
    const result = spawnSync("where", ["git.exe"], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      for (const line of result.stdout.trim().split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate) continue;
        addIfExists(candidate, `PATH git.exe (${candidate})`);
        if (found.some(c => c.git === candidate)) break;
      }
    }
  } catch {}

  const gitRoots = [];
  if (env.ProgramFiles) gitRoots.push(`${env.ProgramFiles}\\Git`);
  if (env["ProgramFiles(x86)"]) gitRoots.push(`${env["ProgramFiles(x86)"]}\\Git`);
  if (env.LOCALAPPDATA) gitRoots.push(`${env.LOCALAPPDATA}\\Programs\\Git`);
  if (env.USERPROFILE) gitRoots.push(`${env.USERPROFILE}\\scoop\\apps\\git\\current`);
  for (const d of DRIVE_LETTERS) gitRoots.push(`${d}:\\Git`);

  for (const root of gitRoots) {
    addIfExists(`${root}\\cmd\\git.exe`, `Git for Windows (${root}\\cmd\\git.exe)`);
  }

  return found;
}

function findGitRuntime({ env = process.env, bundledOnly = false } = {}) {
  const candidates = getAllGitCandidates({ env, bundledOnly });
  const gitRuntime = candidates[0] ?? null;
  if (gitRuntime) return gitRuntime;

  if (bundledOnly) {
    throw new Error(
      "[win32-exec] Sandboxed Git commands require bundled Git runtime, " +
      "but resources/git/cmd/git.exe was not found. Rebuild the Windows package with vendor/git-portable."
    );
  }

  throw new Error(
    "[win32-exec] No usable git.exe found. Install Git for Windows or rebuild Hanako with bundled PortableGit."
  );
}

function getAllShellCandidates({ preferBundled = false, bundledOnly = false, env = process.env } = {}) {
  const found = [];
  const bundled = getBundledShellCandidates(env);

  if (preferBundled) found.push(...bundled);
  if (bundledOnly) return found;

  // ── 1. 系统 Git Bash 标准 + 常见安装位置 ──
  const gitBashPaths = [];
  if (env.ProgramFiles) {
    gitBashPaths.push(`${env.ProgramFiles}\\Git\\bin\\bash.exe`);
  }
  if (env["ProgramFiles(x86)"]) {
    gitBashPaths.push(`${env["ProgramFiles(x86)"]}\\Git\\bin\\bash.exe`);
  }
  if (env.LOCALAPPDATA) {
    gitBashPaths.push(`${env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`);
  }
  if (env.USERPROFILE) {
    gitBashPaths.push(`${env.USERPROFILE}\\scoop\\apps\\git\\current\\bin\\bash.exe`);
  }
  // 绿色版 / 根目录安装：扫 C-Z 盘，覆盖 E:\Git、F:\Git 等非标准盘符
  for (const d of DRIVE_LETTERS) {
    gitBashPaths.push(`${d}:\\Git\\bin\\bash.exe`);
  }

  for (const p of gitBashPaths) {
    if (existsSync(p)) {
      found.push({ shell: p, args: ["-c"], label: `Git Bash (${p})` });
    }
  }

  // ── 2. 注册表查询 Git 安装路径 ──
  for (const regKey of [
    "HKLM\\SOFTWARE\\GitForWindows",
    "HKCU\\SOFTWARE\\GitForWindows",
    "HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows",
  ]) {
    try {
      const result = spawnSync("reg", ["query", regKey, "/v", "InstallPath"], {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout) {
        const match = result.stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
        if (match) {
          const gitBash = join(match[1].trim(), "bin", "bash.exe");
          if (existsSync(gitBash) && !found.some(c => c.shell === gitBash)) {
            found.push({ shell: gitBash, args: ["-c"], label: `Git Bash via registry ${regKey} (${gitBash})` });
          }
        }
      }
    } catch {}
  }

  // ── 3. 内嵌 PortableGit 的 POSIX runtime ──
  if (!preferBundled) {
    for (const candidate of bundled) {
      if (!found.some(c => c.shell === candidate.shell)) found.push(candidate);
    }
  }

  // ── 4. PATH 上的 bash.exe / sh.exe ──
  for (const name of ["bash.exe", "sh.exe"]) {
    try {
      const result = spawnSync("where", [name], { encoding: "utf-8", timeout: 5000, windowsHide: true });
      if (result.status === 0 && result.stdout) {
        for (const line of result.stdout.trim().split(/\r?\n/)) {
          const candidate = line.trim();
          if (!candidate || !existsSync(candidate)) continue;
          if (found.some(c => c.shell === candidate)) continue;
          // System32/SysWOW64 下的 bash.exe 是 WSL launcher，不是真正的 bash shell
          // WSL 进入不同的文件系统命名空间，cwd/PATH/编码全对不上
          const lower = candidate.toLowerCase();
          if (lower.includes("\\windows\\system32\\") || lower.includes("\\windows\\syswow64\\")) continue;
          found.push({ shell: candidate, args: ["-c"], label: `PATH ${name} (${candidate})` });
          break;
        }
      }
    } catch {}
  }

  // ── 5. MSYS2 / Cygwin ──
  // 默认装在盘符根下的 msys64 / cygwin64 / cygwin，扫 C-Z 盘覆盖非 C 盘安装
  for (const d of DRIVE_LETTERS) {
    for (const p of [
      `${d}:\\msys64\\usr\\bin\\bash.exe`,
      `${d}:\\cygwin64\\bin\\bash.exe`,
      `${d}:\\cygwin\\bin\\bash.exe`,
    ]) {
      if (existsSync(p) && !found.some(c => c.shell === p)) {
        found.push({ shell: p, args: ["-c"], label: `MSYS2/Cygwin (${p})` });
      }
    }
  }

  // PowerShell 不在候选列表中：PI SDK 生成 bash 语法（&&、管道、command substitution 等），
  // PowerShell 语法完全不兼容，静默降级只会让每条命令以莫名方式失败。
  // 如果所有 bash 兼容 shell 都不可用，应该 fail fast 并给出明确的安装指引。

  return found;
}

/**
 * 从候选列表中找到第一个 probe 成功的 shell 并缓存
 * @param {string} [startAfter] - 跳过此路径及之前的所有候选（用于降级重试）
 */
function shellCacheMatchesOptions(shellInfo, options = {}) {
  if (!shellInfo) return false;
  if (options.bundledOnly && !shellInfo.bundledRoot) return false;
  if (options.preferBundled && !shellInfo.bundledRoot) return false;
  return true;
}

function findAndCacheShell(startAfter, options = {}) {
  // 有缓存且不是降级重试 → 直接返回
  if (_cachedShell && !startAfter && shellCacheMatchesOptions(_cachedShell, options)) return _cachedShell;

  const candidates = getAllShellCandidates(options);

  // 降级重试：跳过 startAfter 及之前的候选
  let startIdx = 0;
  if (startAfter) {
    const idx = candidates.findIndex(c => c.shell === startAfter);
    if (idx >= 0) startIdx = idx + 1;
  }

  const failures = [];

  for (let i = startIdx; i < candidates.length; i++) {
    const c = candidates[i];
    if (probeShell(c.shell, c.args)) {
      _cachedShell = c;
      return c;
    }
    failures.push(c.label);
  }

  // 全部失败
  const allLabels = startAfter
    ? [`(前序已跳过)`, ...failures]
    : candidates.map(c => c.label);
  if (options.bundledOnly) {
    throw new Error(
      `[win32-exec] Sandboxed POSIX commands require bundled POSIX runtime under resources/git.\n` +
      `Tried bundled candidates:\n${allLabels.map(s => `  - ${s}`).join("\n") || "  - (none found)"}\n\n` +
      `Rebuild the Windows package with vendor/git-portable, or disable sandbox explicitly.`
    );
  }
  throw new Error(
    `[win32-exec] No usable bash-compatible shell found.\n` +
    `Tried (probe failed):\n${allLabels.map(s => `  - ${s}`).join("\n")}\n\n` +
    `Suggestions:\n` +
    `  1. Install Git for Windows: https://git-scm.com/download/win\n` +
    `  2. Make sure bash.exe has execute permission\n` +
    `  3. If using antivirus software, check if it blocks bash.exe`
  );
}

// ── Spawn 错误判断 ──

const SPAWN_ERROR_CODES = new Set(["ENOENT", "EACCES", "EPERM", "UNKNOWN"]);

/**
 * 判断是否为 shell 启动失败的 spawn 级错误
 * 区分于：命令级错误（shell 启动了但命令返回非零）、abort/timeout、cwd 不存在等
 *
 * Node.js spawn 在 shell 可执行文件不存在时：err.code="ENOENT", err.path=shellPath
 * 在 cwd 不存在时也抛 ENOENT，但 err.path 不等于 shell 路径
 * 只有确认是 shell 本身的问题才触发降级重试
 */
function isShellSpawnError(err, shellPath) {
  if (!err || typeof err.code !== "string") return false;
  if (!SPAWN_ERROR_CODES.has(err.code)) return false;
  // ENOENT 特殊处理：只有 err.path 指向 shell 可执行文件时才算 shell 问题
  // cwd 不存在也会 ENOENT，但 err.path 会是 undefined 或其他值
  if (err.code === "ENOENT" && err.path && err.path !== shellPath) return false;
  return true;
}

/**
 * 包装错误信息，附带完整诊断
 */
function enrichError(retryErr, primaryShell, originalErr) {
  const msg = [
    `[win32-exec] Cannot execute shell command.`,
    ``,
    `Primary shell: ${primaryShell.label}`,
    `  Error: ${originalErr.message} (${originalErr.code || "unknown"})`,
    ``,
    `Fallback also failed: ${retryErr.message}`,
    ``,
    `Suggestions:`,
    `  1. Reinstall Git for Windows: https://git-scm.com/download/win`,
    `  2. Make sure bash.exe has execute permission`,
    `  3. If using antivirus software, check if it blocks bash.exe`,
  ].join("\n");

  const enriched = new Error(msg);
  enriched.code = originalErr.code;
  return enriched;
}

// ── Shell 环境 ──

/**
 * 构建干净的 shell 执行环境
 * 移除 ELECTRON_RUN_AS_NODE（不应泄漏到用户命令子进程）
 */
function cleanShellEnv(baseEnv) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function getShellEnv() {
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  return cleanShellEnv({ ...process.env, [pathKey]: process.env[pathKey] ?? "" });
}

function getRuntimeEnvForCandidate(baseEnv, runtimeInfo) {
  const env = cleanShellEnv(baseEnv || {});
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const current = String(env[pathKey] ?? "");
  const executable = runtimeInfo?.shell || runtimeInfo?.git || runtimeInfo?.executable;
  const isWinPath = isWin32PathLike(executable || "");
  const delimiter = current.includes(";") || isWinPath ? ";" : path.delimiter;
  const dirs = [];
  if (executable) dirs.push(dirnameRuntimePath(executable));
  if (runtimeInfo?.bundledRoot) {
    dirs.push(...getBundledRuntimePathDirs(runtimeInfo.bundledRoot));
  }
  for (const dir of runtimeInfo?.extraPathDirs || []) dirs.push(dir);
  const existing = new Set(current.split(delimiter).filter(Boolean).map((entry) => entry.toLowerCase()));
  const prepend = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const key = dir.toLowerCase();
    if (existing.has(key) || prepend.some((entry) => entry.toLowerCase() === key)) continue;
    prepend.push(dir);
  }
  env[pathKey] = [...prepend, ...current.split(delimiter).filter(Boolean)].join(delimiter);
  return env;
}

function getBundledRuntimePathDirs(bundledRoot) {
  return [
    joinRuntimePath(bundledRoot, "bin"),
    joinRuntimePath(bundledRoot, "usr", "bin"),
    joinRuntimePath(bundledRoot, "mingw64", "bin"),
    joinRuntimePath(bundledRoot, "cmd"),
  ];
}

function getShellEnvForCandidate(baseEnv, shellInfo) {
  return getRuntimeEnvForCandidate(baseEnv, shellInfo);
}

function splitShellLikeArgs(command) {
  const args = [];
  let current = "";
  let quote = null;

  const input = String(command || "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === "\\" && quote !== "'") {
      const next = input[i + 1];
      if (next && (/\s/.test(next) || next === "'" || next === "\"" || next === "\\")) {
        current += next;
        i += 1;
      } else {
        current += ch;
      }
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (quote) throw new Error(`[win32-exec] Unterminated quote in command: ${command}`);
  if (current.length > 0) args.push(current);
  return args;
}

function parseGitCommandArgs(command) {
  const args = splitShellLikeArgs(command);
  const commandName = basenameRuntimePath(args[0] || "").toLowerCase();
  if (commandName !== "git" && commandName !== "git.exe") {
    throw new Error(`[win32-exec] Internal error: git runner received non-git command: ${command}`);
  }
  return args.slice(1);
}

function isPythonCommandName(name) {
  return PYTHON_COMMANDS.has(String(name || "").toLowerCase());
}

function isNodeCommandName(name) {
  return NODE_COMMANDS.has(String(name || "").toLowerCase());
}

function resolveExplicitExecutableToken(token, cwd) {
  const raw = String(token || "");
  if (!raw) return null;
  if (isWin32PathLike(raw)) return raw;
  if (/^\.{1,2}[\\/]/.test(raw) || raw.includes("\\") || raw.includes("/")) {
    return resolveRuntimePath(cwd, raw);
  }
  return null;
}

function executableInfoFromPath(executable, label) {
  return { executable, label };
}

function isUsableCurrentNodeRuntime(executable) {
  return !!executable && existsSync(executable);
}

function findNodeRuntimeOnPath(commandName, args, env) {
  const candidates = [];
  if (env?.HANA_DEV_NODE_BIN) candidates.push(executableInfoFromPath(env.HANA_DEV_NODE_BIN, `HANA_DEV_NODE_BIN (${env.HANA_DEV_NODE_BIN})`));
  if (isUsableCurrentNodeRuntime(process.execPath)) {
    candidates.push(executableInfoFromPath(process.execPath, `Current Node runtime (${process.execPath})`));
  }

  try {
    const result = spawnSync("where", [commandName], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    if (result.status === 0 && result.stdout) {
      for (const line of result.stdout.trim().split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate || !existsSync(candidate)) continue;
        if (!isNodeCommandName(basenameRuntimePath(candidate).toLowerCase())) continue;
        candidates.push(executableInfoFromPath(candidate, `PATH Node (${candidate})`));
      }
    }
  } catch {}

  for (const candidate of candidates) {
    const executable = candidate.executable;
    if (!executable || !existsSync(executable)) continue;
    return { ...candidate, args };
  }
  return null;
}

function findNodeRuntime({ command, cwd, env = process.env } = {}) {
  const args = splitShellLikeArgs(command);
  const token = args[0] || "";
  const commandName = basenameRuntimePath(token).toLowerCase();
  if (!isNodeCommandName(commandName)) {
    throw new Error(`[win32-exec] Internal error: node runner received non-node command: ${command}`);
  }

  const explicit = resolveExplicitExecutableToken(token, cwd);
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`[win32-exec] Node executable not found: ${explicit}`);
    }
    if (!isInsideRuntimeRoot(explicit, cwd)) {
      const pathRuntime = findNodeRuntimeOnPath(commandName, args.slice(1), env);
      if (!pathRuntime || !runtimePathsEqual(pathRuntime.executable, explicit)) {
        throw new Error(
          `[win32-exec] Explicit Node executable is outside the workspace and not available on PATH: ${explicit}`
        );
      }
      return pathRuntime;
    }
    return { executable: explicit, args: args.slice(1), label: `Node (${explicit})` };
  }

  const pathRuntime = findNodeRuntimeOnPath(commandName, args.slice(1), env);
  if (pathRuntime) return pathRuntime;

  throw new Error(
    `[win32-exec] No usable Node runtime found for "${commandName}". ` +
    `Install Node.js, add it to PATH, or use an explicit node.exe path.`
  );
}

function findPythonRuntimeOnPath(commandName, args, env) {
  try {
    const result = spawnSync("where", [commandName], {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
      env,
    });
    if (result.status === 0 && result.stdout) {
      for (const line of result.stdout.trim().split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate || !existsSync(candidate)) continue;
        if (!isPythonCommandName(basenameRuntimePath(candidate).toLowerCase())) continue;
        return { executable: candidate, args, label: `PATH Python (${candidate})` };
      }
    }
  } catch {}
  return null;
}

function findPythonRuntime({ command, cwd, env = process.env } = {}) {
  const args = splitShellLikeArgs(command);
  const token = args[0] || "";
  const commandName = basenameRuntimePath(token).toLowerCase();
  if (!isPythonCommandName(commandName)) {
    throw new Error(`[win32-exec] Internal error: python runner received non-python command: ${command}`);
  }

  const explicit = resolveExplicitExecutableToken(token, cwd);
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`[win32-exec] Python executable not found: ${explicit}`);
    }
    if (!isInsideRuntimeRoot(explicit, cwd)) {
      const pathRuntime = findPythonRuntimeOnPath(commandName, args.slice(1), env);
      if (!pathRuntime || !runtimePathsEqual(pathRuntime.executable, explicit)) {
        throw new Error(
          `[win32-exec] Explicit Python executable is outside the workspace and not available on PATH: ${explicit}`
        );
      }
      return pathRuntime;
    }
    return { executable: explicit, args: args.slice(1), label: `Python (${explicit})` };
  }

  const pathRuntime = findPythonRuntimeOnPath(commandName, args.slice(1), env);
  if (pathRuntime) return pathRuntime;

  throw new Error(
    `[win32-exec] No usable Python runtime found for "${commandName}". ` +
    `Install Python, add it to PATH, or use an explicit python.exe path.`
  );
}

function spawnViaCmd(command, cwd, { env, onData, signal, timeout }) {
  return spawnAndStream(process.env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", command], {
    cwd,
    env,
    onData,
    signal,
    timeout,
  });
}

function sandboxIsEnabled(sandbox) {
  return !!sandbox;
}

function mergeUniqueRuntimePaths(...groups) {
  const out = [];
  for (const group of groups) {
    for (const item of group || []) pushUniqueRuntimePath(out, item);
  }
  return out;
}

function normalizeRuntimeGrants(runtimeGrants) {
  if (Array.isArray(runtimeGrants)) {
    return { optionalReadPaths: runtimeGrants };
  }
  return runtimeGrants || {};
}

function mergeGrantPaths(base, extra) {
  return {
    readPaths: mergeUniqueRuntimePaths(base.readPaths || [], extra.readPaths || []),
    optionalReadPaths: mergeUniqueRuntimePaths(base.optionalReadPaths || [], extra.optionalReadPaths || []),
    writePaths: mergeUniqueRuntimePaths(base.writePaths || [], extra.writePaths || []),
    optionalWritePaths: mergeUniqueRuntimePaths(base.optionalWritePaths || [], extra.optionalWritePaths || []),
    denyWritePaths: base.denyWritePaths || [],
  };
}

function readOnlyRuntimeGrants(paths) {
  return { optionalReadPaths: paths || [] };
}

function fullRuntimeGrants(paths) {
  return { optionalWritePaths: paths || [] };
}

function grantsForSandbox(sandbox, cwd, runtimeGrants) {
  if (!sandbox) return { readPaths: [], optionalReadPaths: [], writePaths: [], optionalWritePaths: [], denyWritePaths: [] };
  const runtime = normalizeRuntimeGrants(runtimeGrants);
  if (sandbox.grants) {
    return mergeGrantPaths({
      readPaths: sandbox.grants.readPaths || [],
      optionalReadPaths: sandbox.grants.optionalReadPaths || [],
      writePaths: sandbox.grants.writePaths || [],
      optionalWritePaths: sandbox.grants.optionalWritePaths || [],
      denyWritePaths: sandbox.grants.denyWritePaths || [],
    }, runtime);
  }
  const grants = buildWin32SandboxGrants({
    policy: sandbox.policy,
    cwd,
    externalReadPaths: typeof sandbox.getExternalReadPaths === "function"
      ? sandbox.getExternalReadPaths()
      : [],
    runtimeReadPaths: [],
  });
  return mergeGrantPaths(grants, runtime);
}

function resolveSandboxNetwork(sandbox) {
  const mode = typeof sandbox.getSandboxNetworkMode === "function"
    ? sandbox.getSandboxNetworkMode()
    : null;
  const enabled = typeof sandbox.getSandboxNetworkEnabled === "function"
    ? sandbox.getSandboxNetworkEnabled()
    : false;

  if (mode === "none" || mode === false) return {};
  if (mode === "outbound" || mode === "internet-client") return { internetClient: true };
  if (mode === "local-server" || mode === "internet-server") {
    return {
      internetClient: true,
      internetClientServer: true,
      privateNetworkClientServer: true,
    };
  }
  if (!enabled) return {};
  return {
    internetClient: true,
    internetClientServer: true,
    privateNetworkClientServer: true,
  };
}

function spawnViaSandboxHelper({ sandbox, executable, args, cwd, env, onData, signal, timeout, runtimeGrants }) {
  const helper = sandbox.helperPath || resolveWin32SandboxHelper({ env });
  if (!helper) {
    throw new Error(
      "[win32-sandbox] Windows AppContainer helper is unavailable. " +
      "Run scripts/build-windows-sandbox-helper.mjs during packaging, or disable sandbox explicitly."
    );
  }
  const helperArgs = buildWin32SandboxHelperArgs({
    cwd,
    network: resolveSandboxNetwork(sandbox),
    grants: grantsForSandbox(sandbox, cwd, runtimeGrants),
    executable,
    args,
  });
  return spawnAndStream(helper, helperArgs, { cwd, env, onData, signal, timeout });
}

function runtimeReadPathsForBundledRuntime(runtimeInfo) {
  const paths = [];
  pushUniqueRuntimePath(paths, runtimeInfo?.bundledRoot);
  const executable = runtimeInfo?.shell || runtimeInfo?.git || runtimeInfo?.executable;
  pushUniqueRuntimePath(paths, executable);
  if (executable) pushUniqueRuntimePath(paths, dirnameRuntimePath(executable));
  if (runtimeInfo?.bundledRoot) {
    for (const dir of getBundledRuntimePathDirs(runtimeInfo.bundledRoot)) {
      pushUniqueRuntimePath(paths, dir);
    }
  }
  return paths;
}

function runtimeReadPathsForPythonRuntime(runtimeInfo) {
  const paths = [];
  const executable = runtimeInfo?.executable;
  pushUniqueRuntimePath(paths, executable);
  if (!executable) return paths;

  const executableDir = dirnameRuntimePath(executable);
  const runtimeRoot = basenameRuntimePath(executableDir).toLowerCase() === "scripts"
    ? dirnameRuntimePath(executableDir)
    : executableDir;

  pushUniqueRuntimePath(paths, executableDir);
  pushUniqueRuntimePath(paths, runtimeRoot);
  return paths;
}

function runtimeReadPathsForNodeRuntime(runtimeInfo) {
  const paths = [];
  const executable = runtimeInfo?.executable;
  pushUniqueRuntimePath(paths, executable);
  if (!executable) return paths;

  const executableDir = dirnameRuntimePath(executable);
  pushUniqueRuntimePath(paths, executableDir);
  return paths;
}

// ── 导出 ──

/**
 * 创建 Windows 平台的 bash exec 函数
 *
 * spawn 失败时自动降级到下一个可用 shell（清缓存 + 重试）。
 * 只对 spawn 级错误（ENOENT/EACCES/EPERM）降级，abort/timeout/命令错误原样抛出。
 *
 * @returns {(command: string, cwd: string, opts: object) => Promise<{exitCode: number|null}>}
 */
export function createWin32Exec({ sandbox = null } = {}) {
  return async (command, cwd, { onData, signal, timeout, env }) => {
    const shellEnv = cleanShellEnv(env ?? getShellEnv());
    const route = classifyWin32Command(command);

    if (route.runner === "cmd") {
      if (sandboxIsEnabled(sandbox)) {
        const executable = process.env.COMSPEC || "cmd.exe";
        const args = ["/d", "/s", "/c", command];
        return spawnViaSandboxHelper({
          sandbox,
          executable,
          args,
          cwd,
          env: shellEnv,
          onData,
          signal,
          timeout,
          runtimeGrants: readOnlyRuntimeGrants([]),
        });
      }
      return spawnViaCmd(command, cwd, {
        env: shellEnv,
        onData,
        signal,
        timeout,
      });
    }

    if (route.runner === "git") {
      const gitInfo = findGitRuntime({
        env: shellEnv,
        bundledOnly: sandboxIsEnabled(sandbox),
      });
      const gitArgs = parseGitCommandArgs(command);
      const gitEnv = getRuntimeEnvForCandidate(shellEnv, gitInfo);
      const runtimeReadPaths = runtimeReadPathsForBundledRuntime(gitInfo);

      if (sandboxIsEnabled(sandbox)) {
        return spawnViaSandboxHelper({
          sandbox,
          executable: gitInfo.git,
          args: gitArgs,
          cwd,
          env: gitEnv,
          onData,
          signal,
          timeout,
          runtimeGrants: readOnlyRuntimeGrants(runtimeReadPaths),
        });
      }

      return spawnAndStream(gitInfo.git, gitArgs, {
        cwd,
        env: gitEnv,
        onData,
        signal,
        timeout,
      });
    }

    if (route.runner === "python") {
      const pythonInfo = findPythonRuntime({ command, cwd, env: shellEnv });
      const pythonEnv = getRuntimeEnvForCandidate(shellEnv, pythonInfo);
      const runtimeReadPaths = runtimeReadPathsForPythonRuntime(pythonInfo);

      if (sandboxIsEnabled(sandbox)) {
        return spawnViaSandboxHelper({
          sandbox,
          executable: pythonInfo.executable,
          args: pythonInfo.args,
          cwd,
          env: pythonEnv,
          onData,
          signal,
          timeout,
          runtimeGrants: fullRuntimeGrants(runtimeReadPaths),
        });
      }

      return spawnAndStream(pythonInfo.executable, pythonInfo.args, {
        cwd,
        env: pythonEnv,
        onData,
        signal,
        timeout,
      });
    }

    if (route.runner === "node") {
      const nodeInfo = findNodeRuntime({ command, cwd, env: shellEnv });
      const nodeEnv = getRuntimeEnvForCandidate(shellEnv, nodeInfo);
      const runtimeReadPaths = runtimeReadPathsForNodeRuntime(nodeInfo);

      if (sandboxIsEnabled(sandbox)) {
        return spawnViaSandboxHelper({
          sandbox,
          executable: nodeInfo.executable,
          args: nodeInfo.args,
          cwd,
          env: nodeEnv,
          onData,
          signal,
          timeout,
          runtimeGrants: readOnlyRuntimeGrants(runtimeReadPaths),
        });
      }

      return spawnAndStream(nodeInfo.executable, nodeInfo.args, {
        cwd,
        env: nodeEnv,
        onData,
        signal,
        timeout,
      });
    }

    assertSafeWin32BashCommand(command);

    const shellInfo = findAndCacheShell(null, {
      preferBundled: true,
      bundledOnly: sandboxIsEnabled(sandbox),
      env: shellEnv,
    });
    const execEnv = getShellEnvForCandidate(shellEnv, shellInfo);
    const bashRuntimeReadPaths = runtimeReadPathsForBundledRuntime(shellInfo);

    if (sandboxIsEnabled(sandbox)) {
      return spawnViaSandboxHelper({
        sandbox,
        executable: shellInfo.shell,
        args: [...shellInfo.args, command],
        cwd,
        env: execEnv,
        onData,
        signal,
        timeout,
        runtimeGrants: readOnlyRuntimeGrants(bashRuntimeReadPaths),
      });
    }

    try {
      return await spawnAndStream(shellInfo.shell, [...shellInfo.args, command], {
        cwd, env: execEnv, onData, signal, timeout,
      });
    } catch (err) {
      // 只对 shell 启动失败降级（ENOENT 指向 shell 二进制、EACCES、EPERM）
      // abort / timeout / 命令本身报错 / cwd 不存在 → 原样抛出
      if (!isShellSpawnError(err, shellInfo.shell)) throw err;

      console.warn(`[win32-exec] Shell exec failed (${shellInfo.label}): ${err.code} ${err.message}, trying fallback…`);
      _cachedShell = null;
      let fallback = null;

      try {
        fallback = findAndCacheShell(shellInfo.shell);
        const fallbackEnv = getShellEnvForCandidate(shellEnv, fallback);
        console.warn(`[win32-exec] 降级到: ${fallback.label}`);
        return await spawnAndStream(fallback.shell, [...fallback.args, command], {
          cwd, env: fallbackEnv, onData, signal, timeout,
        });
      } catch (retryErr) {
        // 降级也失败：抛出富化的错误信息
        if (fallback && isShellSpawnError(retryErr, fallback.shell)) {
          throw enrichError(retryErr, shellInfo, err);
        }
        throw retryErr;
      }
    }
  };
}

export const __testing = {
  getBundledShellCandidates,
  getShellEnvForCandidate,
};
