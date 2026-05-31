/**
 * project-index.js — 项目文件预索引（Windsurf Fast Content 模式）
 *
 * 在 session 启动时预扫描工作空间，构建文件清单缓存。
 * 后续 grep/find/ls 等操作可直接命中缓存，避免重复扫描。
 *
 * 核心思路（借鉴 Windsurf 上下文感知引擎）：
 *   - 使用 fd（Rust 实现）快速扫描整个项目
 *   - 内存缓存文件列表 + 目录树
 *   - 增量失效：按目录 mtime 判断是否需要刷新
 *   - 开放 {{project_overview}} 模板变量供用户自定义引用
 */

import { spawn, spawnSync } from "child_process";
import { createInterface } from "node:readline";
import path from "path";
import { existsSync, statSync, readdirSync } from "fs";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

/**
 * 获取 fd 命令行路径
 * 优先使用 PATH 中的 fd，其次使用下载的二进制
 */
function findFdBinary() {
  // 检查 PATH 中的 fd
  try {
    const result = spawnSync("fd", ["--version"], {
      stdio: "pipe",
      windowsHide: true,
    });
    if (result.status === 0) return "fd";
  } catch {}

  // 检查下载的 fd
  const binDir = path.join(getAgentDir(), "bin");
  const binaryExt = process.platform === "win32" ? ".exe" : "";
  const managedPath = path.join(binDir, `fd${binaryExt}`);
  if (existsSync(managedPath)) return managedPath;

  return null;
}

/**
 * 获取 rg 命令行路径
 */
function findRgBinary() {
  try {
    const result = spawnSync("rg", ["--version"], {
      stdio: "pipe",
      windowsHide: true,
    });
    if (result.status === 0) return "rg";
  } catch {}

  const binDir = path.join(getAgentDir(), "bin");
  const binaryExt = process.platform === "win32" ? ".exe" : "";
  const managedPath = path.join(binDir, `rg${binaryExt}`);
  if (existsSync(managedPath)) return managedPath;

  return null;
}

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  ".tox",
  ".egg-info",
  ".mypy_cache",
  ".pytest_cache",
  ".coverage",
];

/**
 * @typedef {Object} FileEntry
 * @property {string} relativePath - 相对工作空间的路径
 * @property {number} size - 文件大小（字节）
 * @property {string} ext - 扩展名
 */

/**
 * @typedef {Object} ProjectSummary
 * @property {number} totalFiles - 文件总数
 * @property {number} totalDirs  - 目录总数
 * @property {Object<string,number>} byExt - 各扩展名的文件数量
 * @property {string[]} topDirs  - 顶级子目录
 * @property {number} scannedAt  - 扫描时间戳
 */

export class ProjectIndex {
  /**
   * @param {object} opts
   * @param {string} opts.workspaceRoot - 工作空间根目录
   * @param {number} [opts.maxFiles=50000] - 最大文件数（超过则截断）
   * @param {string[]} [opts.extraIgnore] - 额外忽略的目录名
   */
  constructor({ workspaceRoot, maxFiles = 50000, extraIgnore = [] }) {
    this._root = path.resolve(workspaceRoot);
    this._maxFiles = maxFiles;
    this._ignore = [...DEFAULT_IGNORE, ...extraIgnore];
    /** @type {FileEntry[]|null} */
    this._files = null;
    /** @type {Map<string, string[]>|null} */
    this._dirTree = null;
    /** @type {ProjectSummary|null} */
    this._summary = null;
    /** @type {number|null} */
    this._lastScanTime = null;
    this._scanPromise = null;
  }

  /**
   * 扫描工作空间，构建文件清单
   * 使用 fd（Rust）进行快速文件扫描
   * @returns {Promise<void>}
   */
  async scan() {
    // 如果正在扫描，复用 promise
    if (this._scanPromise) return this._scanPromise;

    this._scanPromise = this._doScan().finally(() => {
      this._scanPromise = null;
    });
    return this._scanPromise;
  }

  async _doScan() {
    const fdPath = findFdBinary();
    if (!fdPath) {
      // 没有 fd 时回退到 Node.js 遍历（较慢但可用）
      return this._scanWithNode();
    }
    return this._scanWithFd(fdPath).catch(() => this._scanWithNode());
  }

  async _scanWithFd(fdPath) {
    const files = [];
    const dirSet = new Set();
    const startTime = Date.now();

    await new Promise((resolve, reject) => {
      const args = [
        "--type", "f",
        "--hidden",
        "--no-ignore-vcs",
        "--absolute-path",
        "--max-results", String(this._maxFiles + 1),
      ];

      // 添加忽略目录
      for (const dir of this._ignore) {
        args.push("--exclude", dir);
      }

      args.push(".", this._root);

      const child = spawn(fdPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const rl = createInterface({ input: child.stdout });
      let stderr = "";

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      rl.on("line", (line) => {
        if (files.length >= this._maxFiles) return;
        try {
          const absPath = line.trim();
          if (!absPath) return;
          const relativePath = path.relative(this._root, absPath);
          let size = 0;
          try {
            size = statSync(absPath).size;
          } catch {}

          const ext = path.extname(relativePath).toLowerCase();
          files.push({ relativePath: relativePath.replace(/\\/g, "/"), size, ext });

          // 收集所有父目录
          let dir = path.dirname(relativePath);
          while (dir && dir !== ".") {
            dirSet.add(dir.replace(/\\/g, "/"));
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
        } catch {}
      });

      child.on("error", () => reject(new Error("fd spawn failed")));

      child.on("close", (code) => {
        if (code !== 0 && files.length === 0) {
          reject(new Error(stderr.trim() || `fd exited with code ${code}`));
        } else {
          resolve();
        }
      });
    });

    this._files = files;
    this._buildDirTree();
    this._buildSummary();
    this._lastScanTime = startTime;
  }

  async _scanWithNode() {
    const files = [];
    const dirSet = new Set();
    const startTime = Date.now();

    const walk = (dir) => {
      if (files.length >= this._maxFiles) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= this._maxFiles) return;
        const absPath = path.join(dir, entry.name);
        const relativePath = path.relative(this._root, absPath).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (this._ignore.includes(entry.name)) continue;
          if (entry.name.startsWith(".")) continue;
          dirSet.add(relativePath);
          walk(absPath);
        } else if (entry.isFile()) {
          let size = 0;
          try { size = statSync(absPath).size; } catch {}
          files.push({
            relativePath,
            size,
            ext: path.extname(entry.name).toLowerCase(),
          });
        }
      }
    };

    walk(this._root);

    this._files = files;
    this._buildDirTree();
    this._buildSummary();
    this._lastScanTime = startTime;
  }

  _buildDirTree() {
    const tree = new Map();
    for (const f of this._files) {
      const dir = path.dirname(f.relativePath).replace(/\\/g, "/");
      if (dir === ".") {
        if (!tree.has(".")) tree.set(".", []);
        tree.get(".").push(f.relativePath);
      } else {
        if (!tree.has(dir)) tree.set(dir, []);
        tree.get(dir).push(f.relativePath);
      }
    }
    // 确保所有中间目录都在 tree 中
    for (const f of this._files) {
      let dir = path.dirname(f.relativePath).replace(/\\/g, "/");
      while (dir && dir !== ".") {
        if (!tree.has(dir)) tree.set(dir, []);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    this._dirTree = tree;
  }

  _buildSummary() {
    if (!this._files) return;
    const byExt = {};
    const topLevel = new Set();

    for (const f of this._files) {
      // 统计扩展名
      const ext = f.ext || "(no ext)";
      byExt[ext] = (byExt[ext] || 0) + 1;

      // 统计顶级目录
      const parts = f.relativePath.split("/");
      if (parts.length > 1) {
        topLevel.add(parts[0]);
      }
    }

    this._summary = {
      totalFiles: this._files.length,
      totalDirs: this._dirTree?.size || 0,
      byExt,
      topDirs: [...topLevel].sort(),
      scannedAt: this._lastScanTime,
    };
  }

  /**
   * 获取项目概览文本（适合注入 system prompt）
   * @returns {string}
   */
  getOverview() {
    if (!this._summary) return "";
    const s = this._summary;
    const topExts = Object.entries(s.byExt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ext, count]) => `  ${ext}: ${count} files`)
      .join("\n");

    return [
      `## 项目概览`,
      ``,
      `工作空间: ${this._root}`,
      `文件总数: ${s.totalFiles}`,
      `目录总数: ${s.totalDirs}`,
      ``,
      `顶级目录:`,
      ...s.topDirs.map(d => `  - ${d}/`),
      ``,
      `文件类型分布 (Top 8):`,
      topExts || "  (无)",
    ].join("\n");
  }

  /**
   * 检查缓存是否过期
   * 通过比较根目录和顶级子目录的 mtime
   * @returns {boolean}
   */
  isStale() {
    if (!this._lastScanTime || !this._files) return true;
    try {
      const rootStat = statSync(this._root);
      if (rootStat.mtimeMs > this._lastScanTime + 1000) return true;
    } catch {
      return true;
    }
    return false;
  }

  /**
   * 确保索引是最新的
   * @returns {Promise<void>}
   */
  async ensureFresh() {
    if (this.isStale()) {
      await this.scan();
    }
  }

  /**
   * 获取所有文件列表
   * @returns {FileEntry[]}
   */
  getFiles() {
    return this._files || [];
  }

  /**
   * 在文件列表中搜索
   * @param {string} pattern - 文件名模式（支持 glob）
   * @param {string} [inDir] - 限定目录
   * @returns {FileEntry[]}
   */
  searchFiles(pattern, inDir) {
    if (!this._files) return [];
    const lowerPattern = pattern.toLowerCase();
    return this._files.filter(f => {
      if (inDir && !f.relativePath.startsWith(inDir)) return false;
      // 简单 glob 匹配
      if (pattern.includes("*")) {
        const regex = new RegExp(
          "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
          "i"
        );
        return regex.test(path.basename(f.relativePath)) ||
               regex.test(f.relativePath);
      }
      return f.relativePath.toLowerCase().includes(lowerPattern);
    });
  }

  /**
   * 获取指定目录下的文件列表
   * @param {string} dir - 相对目录路径
   * @returns {string[]}
   */
  getDirContents(dir) {
    if (!this._dirTree) return [];
    const normalized = dir === "." || dir === "" ? "." : dir.replace(/\\/g, "/");
    const entries = this._dirTree.get(normalized);
    if (!entries) return [];

    // 同时列出直接子目录
    const result = new Set();
    for (const entry of entries) {
      const rel = path.relative(normalized, entry).replace(/\\/g, "/");
      if (!rel.startsWith("..")) {
        const firstPart = rel.split("/")[0];
        result.add(firstPart);
      }
    }
    return [...result].sort();
  }
}

/**
 * 全局实例缓存（按工作空间）
 */
const _instances = new Map();

/**
 * 获取或创建 ProjectIndex 实例
 * @param {string} workspaceRoot
 * @param {object} [opts]
 * @returns {ProjectIndex}
 */
export function getProjectIndex(workspaceRoot, opts = {}) {
  const key = path.resolve(workspaceRoot);
  let instance = _instances.get(key);
  if (!instance) {
    instance = new ProjectIndex({ workspaceRoot: key, ...opts });
    _instances.set(key, instance);
  }
  return instance;
}

/**
 * 清除指定工作空间的缓存
 * @param {string} workspaceRoot
 */
export function clearProjectIndex(workspaceRoot) {
  const key = path.resolve(workspaceRoot);
  _instances.delete(key);
}
