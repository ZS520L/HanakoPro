/**
 * extract-zip.js — 跨平台 zip 解压
 *
 * 直接使用应用自带的 JS 解压能力，避免桌面/服务端把核心安装链路外包给
 * 系统环境里的 unzip / PowerShell。
 */

import extractZipImpl from "extract-zip";

export async function extractZip(zipPath, destDir) {
  await extractZipImpl(zipPath, { dir: destDir });
}
