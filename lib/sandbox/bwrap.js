/**
 * bwrap.js — Linux bubblewrap 沙盒
 *
 * 构造 bwrap 参数，用 argv 数组直接 spawn。
 * 返回符合 Pi SDK BashOperations.exec 接口的函数。
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawnAndStream } from "./exec-helper.js";
import { writeScript, cleanup } from "./script.js";

/**
 * 创建 Linux 沙盒化的 exec 函数
 * @param {object} policy  从 deriveSandboxPolicy() 得到
 * @param {object} [options]
 * @param {() => string[]} [options.getExternalReadPaths]
 * @param {() => boolean} [options.getSandboxNetworkEnabled]
 * @returns {(command, cwd, opts) => Promise<{exitCode}>}
 */
export function createBwrapExec(policy, { getExternalReadPaths, getSandboxNetworkEnabled } = {}) {
  return async (command, cwd, { onData, signal, timeout, env }) => {
    const { scriptPath } = writeScript(command, cwd);
    const args = buildBwrapArgs(policy, {
      cwd,
      env,
      allowNetwork: typeof getSandboxNetworkEnabled === "function"
        ? getSandboxNetworkEnabled()
        : false,
      externalReadPaths: typeof getExternalReadPaths === "function" ? getExternalReadPaths() : [],
      runtimeReadPaths: [scriptPath],
    });
    try {
      return await spawnAndStream(
        "bwrap",
        [...args, "--", "/bin/bash", scriptPath],
        { cwd, env, onData, signal, timeout },
      );
    } finally {
      cleanup(scriptPath);
    }
  };
}

const SYSTEM_READONLY_PATHS = [
  "/bin",
  "/sbin",
  "/usr",
  "/lib",
  "/lib64",
  "/opt",
  "/nix/store",
  "/etc/alternatives",
  "/etc/ssl",
  "/etc/ca-certificates",
  "/etc/pki",
  "/etc/passwd",
  "/etc/group",
  "/etc/nsswitch.conf",
  "/etc/hosts",
  "/etc/localtime",
];

function existingPaths(paths) {
  const out = [];
  const seen = new Set();
  for (const p of paths || []) {
    if (!p || seen.has(p) || !fs.existsSync(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function addParentDirs(args, target, createdDirs) {
  const absolute = path.resolve(target);
  const dirs = [];
  let current = path.dirname(absolute);
  while (current && current !== path.dirname(current)) {
    if (current !== "/" && !createdDirs.has(current)) dirs.push(current);
    current = path.dirname(current);
  }
  for (const dir of dirs.reverse()) {
    createdDirs.add(dir);
    args.push("--dir", dir);
  }
}

function addMount(args, op, source, target, createdDirs) {
  addParentDirs(args, target, createdDirs);
  args.push(op, source, target);
}

function addPrivateRuntimeEnv(args) {
  const runtimeDirs = ["/tmp/hana-home", "/tmp/hana-cache", "/tmp/hana-npm-cache", "/tmp/hana-pip-cache"];
  for (const dir of runtimeDirs) args.push("--dir", dir);
  args.push(
    "--setenv", "HOME", "/tmp/hana-home",
    "--setenv", "XDG_CACHE_HOME", "/tmp/hana-cache",
    "--setenv", "npm_config_cache", "/tmp/hana-npm-cache",
    "--setenv", "PIP_CACHE_DIR", "/tmp/hana-pip-cache",
  );
}

/**
 * 构造 bwrap 参数。Linux 采用 allowlist 挂载：系统运行时只读、workspace/session
 * 授权路径按策略挂载，避免把整个 host filesystem 暴露给命令。
 */
export function buildBwrapArgs(policy, {
  cwd,
  env,
  allowNetwork = false,
  externalReadPaths = [],
  runtimeReadPaths = [],
} = {}) {
  const args = [
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--unshare-pid",
  ];
  if (!allowNetwork) args.push("--unshare-net");
  args.push(
    "--new-session",
    "--die-with-parent",
  );
  const createdDirs = new Set(["/"]);

  addPrivateRuntimeEnv(args);

  for (const p of existingPaths(SYSTEM_READONLY_PATHS)) {
    addMount(args, "--ro-bind", p, p, createdDirs);
  }

  if (cwd && fs.existsSync(cwd)) {
    addMount(args, "--bind", cwd, cwd, createdDirs);
    args.push("--chdir", cwd);
  }

  // 可写路径：覆盖为可写绑定
  for (const p of existingPaths(policy.writablePaths)) {
    addMount(args, "--bind", p, p, createdDirs);
  }

  // 只读授权路径：agent 静态资料、session-files、用户显式给过的外部文件等
  for (const p of existingPaths([
    ...(policy.readablePaths || []),
    ...externalReadPaths,
    ...runtimeReadPaths,
  ])) {
    addMount(args, "--ro-bind", p, p, createdDirs);
  }

  // 受保护路径：在可写范围内再覆盖为只读
  for (const p of existingPaths(policy.protectedPaths)) {
    addMount(args, "--ro-bind", p, p, createdDirs);
  }

  // 读取拒绝：文件绑 /dev/null，目录绑 tmpfs
  for (const p of policy.denyReadPaths || []) {
    if (!fs.existsSync(p)) continue;
    try {
      if (fs.statSync(p).isDirectory()) {
        addParentDirs(args, p, createdDirs);
        args.push("--tmpfs", p);
      } else {
        addMount(args, "--ro-bind", "/dev/null", p, createdDirs);
      }
    } catch {}
  }

  // 兼容少数程序直接读取原 HOME 下的缓存路径：如果路径已存在且未被授予写入，
  // 用 tmpfs 遮蔽成临时目录，防止回落到真实用户缓存。
  const hostHome = env?.HOME || os.homedir();
  for (const d of [path.join(hostHome, ".cache"), path.join(hostHome, ".npm")]) {
    const isWritable = (policy.writablePaths || []).some(
      (w) => d === w || d.startsWith(w + path.sep),
    );
    if (!isWritable && fs.existsSync(d)) {
      addParentDirs(args, d, createdDirs);
      args.push("--tmpfs", d);
    }
  }

  return args;
}
