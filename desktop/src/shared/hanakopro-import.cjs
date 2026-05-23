const fs = require("fs");
const path = require("path");

const IMPORTED_MARKER = ".hanakopro-imported-from-hanako.json";
const DECLINED_MARKER = ".hanakopro-import-declined";
const BOOTSTRAP_ENTRY_NAMES = new Set([".pi", "logs", "crash.log", "last-update-version", "browser-cmd.log"]);
const SOURCE_EXCLUDE_NAMES = new Set([".pi", "logs", ".ephemeral", "server-info.json", "crash.log", "last-update-version", "browser-cmd.log"]);

function normalizeForCompare(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathExists(filePath) {
  try { fs.accessSync(filePath); return true; } catch { return false; }
}

function hasRealTargetData(targetHome) {
  if (!pathExists(targetHome)) return false;
  let entries = [];
  try { entries = fs.readdirSync(targetHome, { withFileTypes: true }); } catch { return true; }
  for (const entry of entries) {
    if (BOOTSTRAP_ENTRY_NAMES.has(entry.name)) continue;
    if (entry.name === IMPORTED_MARKER || entry.name === DECLINED_MARKER) continue;
    return true;
  }
  return false;
}

function hasImportableSourceData(sourceHome) {
  if (!pathExists(sourceHome)) return false;
  let entries = [];
  try { entries = fs.readdirSync(sourceHome, { withFileTypes: true }); } catch { return false; }
  return entries.some(entry => !SOURCE_EXCLUDE_NAMES.has(entry.name));
}

function copyEntry(src, dest) {
  if (pathExists(dest)) return;
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (SOURCE_EXCLUDE_NAMES.has(entry.name)) continue;
      copyEntry(path.join(src, entry.name), path.join(dest, entry.name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function copyOfficialData(sourceHome, targetHome) {
  fs.mkdirSync(targetHome, { recursive: true });
  const entries = fs.readdirSync(sourceHome, { withFileTypes: true });
  for (const entry of entries) {
    if (SOURCE_EXCLUDE_NAMES.has(entry.name)) continue;
    copyEntry(path.join(sourceHome, entry.name), path.join(targetHome, entry.name));
  }
}

function writeJsonMarker(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function shouldOfferOfficialImport({ sourceHome, targetHome }) {
  if (!sourceHome || !targetHome) return { offer: false, reason: "missing-path" };
  if (normalizeForCompare(sourceHome) === normalizeForCompare(targetHome)) return { offer: false, reason: "same-home" };
  if (pathExists(path.join(targetHome, IMPORTED_MARKER))) return { offer: false, reason: "already-imported" };
  if (pathExists(path.join(targetHome, DECLINED_MARKER))) return { offer: false, reason: "declined" };
  if (hasRealTargetData(targetHome)) return { offer: false, reason: "target-has-data" };
  if (!hasImportableSourceData(sourceHome)) return { offer: false, reason: "no-source-data" };
  return { offer: true, reason: "available" };
}

async function promptAndImportOfficialHanakoData({ dialog, sourceHome, targetHome, log = () => {} }) {
  const decision = shouldOfferOfficialImport({ sourceHome, targetHome });
  if (!decision.offer) return { prompted: false, imported: false, reason: decision.reason };
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["导入", "不导入"],
    defaultId: 0,
    cancelId: 1,
    title: "导入官方 Hanako 数据",
    message: "检测到官方 Hanako 的配置和历史记录，是否复制导入到 HanakoPro？",
    detail: `源目录：${sourceHome}\n目标目录：${targetHome}\n\n导入只会复制数据，不会修改或删除官方 Hanako 数据。`,
    noLink: true,
  });
  if (result.response !== 0) {
    fs.mkdirSync(targetHome, { recursive: true });
    fs.writeFileSync(path.join(targetHome, DECLINED_MARKER), new Date().toISOString() + "\n", "utf-8");
    log("HanakoPro import declined");
    return { prompted: true, imported: false, reason: "declined" };
  }
  copyOfficialData(sourceHome, targetHome);
  writeJsonMarker(path.join(targetHome, IMPORTED_MARKER), {
    sourceHome,
    targetHome,
    importedAt: new Date().toISOString(),
  });
  log("HanakoPro import completed");
  return { prompted: true, imported: true, reason: "imported" };
}

module.exports = {
  DECLINED_MARKER,
  IMPORTED_MARKER,
  copyOfficialData,
  hasImportableSourceData,
  hasRealTargetData,
  normalizeForCompare,
  promptAndImportOfficialHanakoData,
  shouldOfferOfficialImport,
};
