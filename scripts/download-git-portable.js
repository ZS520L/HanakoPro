#!/usr/bin/env node
/**
 * download-git-portable.js — CI 用，下载 PortableGit 到 vendor/git-portable/
 *
 * Windows 打包前运行：node scripts/download-git-portable.js
 * electron-builder 的 extraResources 会把 vendor/git-portable/ 打进安装包的 resources/git/
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ROOT, "vendor", "git-portable");

// 官方 Git for Windows PortableGit（thumbdrive edition），包含完整 Git Bash/MSYS2 runtime。
const PORTABLE_GIT_VERSION = "2.54.0";
const PORTABLE_GIT_RELEASE = `v${PORTABLE_GIT_VERSION}.windows.1`;
const PORTABLE_GIT_SHA256 = "bea006a6cc69673f27b1647e84ab3a68e912fbc175ab6320c5987e012897f311";
const PORTABLE_GIT_URL = `https://github.com/git-for-windows/git/releases/download/${PORTABLE_GIT_RELEASE}/PortableGit-${PORTABLE_GIT_VERSION}-64-bit.7z.exe`;
const ARCHIVE_PATH = path.join(ROOT, "vendor", `portablegit-${PORTABLE_GIT_VERSION}.7z.exe`);

function hasPortableGitRuntime() {
  return fs.existsSync(path.join(VENDOR_DIR, "cmd", "git.exe")) &&
    (
      fs.existsSync(path.join(VENDOR_DIR, "bin", "bash.exe")) ||
      fs.existsSync(path.join(VENDOR_DIR, "usr", "bin", "bash.exe"))
    );
}

function verifySha256(filePath, expected) {
  const actual = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (actual !== expected) {
    throw new Error(`PortableGit checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

function extractPortableGitArchive() {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  if (process.platform === "win32") {
    execFileSync(ARCHIVE_PATH, ["-y", `-o${VENDOR_DIR}`], { stdio: "inherit", windowsHide: true });
    return;
  }

  for (const sevenZip of ["7zz", "7z"]) {
    try {
      execFileSync(sevenZip, ["x", "-y", `-o${VENDOR_DIR}`, ARCHIVE_PATH], { stdio: "inherit" });
      return;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  throw new Error("extracting PortableGit on non-Windows hosts requires 7zz or 7z");
}

async function main() {
  // 已存在则跳过
  if (hasPortableGitRuntime()) {
    console.log(`[download-git-portable] PortableGit ${PORTABLE_GIT_VERSION} already present, skipping.`);
    return;
  }

  fs.mkdirSync(path.join(ROOT, "vendor"), { recursive: true });

  // 下载
  console.log(`[download-git-portable] Downloading PortableGit ${PORTABLE_GIT_VERSION}...`);
  execFileSync("curl", ["--fail", "-L", "-o", ARCHIVE_PATH, PORTABLE_GIT_URL], { stdio: "inherit" });
  verifySha256(ARCHIVE_PATH, PORTABLE_GIT_SHA256);

  // 解压
  console.log("[download-git-portable] Extracting...");
  extractPortableGitArchive();

  // 清理 archive
  fs.unlinkSync(ARCHIVE_PATH);

  console.log(`[download-git-portable] PortableGit ${PORTABLE_GIT_VERSION} ready at ${VENDOR_DIR}`);
}

main().catch((err) => {
  console.error("[download-git-portable] Failed:", err.message);
  process.exit(1);
});
