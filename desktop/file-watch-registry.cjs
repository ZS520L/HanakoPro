/**
 * file-watch-registry.cjs
 *
 * 目标：
 * - 同一个 filePath 只保留一个底层 fs.watch
 * - 多个 renderer / window 可以按 subscriberId 共享订阅同一文件
 * - 任意一侧 unwatch / renderer destroyed 只移除自己的订阅，不影响其他订阅者
 */

function createFileWatchRegistry({ watch, notifySubscriber, debounceMs = 50 } = {}) {
  if (typeof watch !== "function") {
    throw new Error("createFileWatchRegistry: watch function required");
  }
  if (typeof notifySubscriber !== "function") {
    throw new Error("createFileWatchRegistry: notifySubscriber function required");
  }

  const entries = new Map(); // filePath -> { watcher, subscribers:Set<number>, debounceTimer }
  const filesBySubscriber = new Map(); // subscriberId -> Set<filePath>

  function bindSubscriber(filePath, subscriberId) {
    let files = filesBySubscriber.get(subscriberId);
    if (!files) {
      files = new Set();
      filesBySubscriber.set(subscriberId, files);
    }
    files.add(filePath);
  }

  function unbindSubscriber(filePath, subscriberId) {
    const files = filesBySubscriber.get(subscriberId);
    if (!files) return;
    files.delete(filePath);
    if (files.size === 0) filesBySubscriber.delete(subscriberId);
  }

  function closeEntry(filePath, entry) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { entry.watcher?.close?.(); } catch {}
    entries.delete(filePath);
  }

  function ensureEntry(filePath) {
    let entry = entries.get(filePath);
    if (entry) return entry;

    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") return;
      const current = entries.get(filePath);
      if (!current) return;
      if (current.debounceTimer) clearTimeout(current.debounceTimer);
      current.debounceTimer = setTimeout(() => {
        current.debounceTimer = null;
        for (const subscriberId of [...current.subscribers]) {
          notifySubscriber(subscriberId, filePath);
        }
      }, debounceMs);
    });

    entry = { watcher, subscribers: new Set(), debounceTimer: null };
    entries.set(filePath, entry);
    return entry;
  }

  function watchFile(filePath, subscriberId) {
    try {
      const entry = ensureEntry(filePath);
      entry.subscribers.add(subscriberId);
      bindSubscriber(filePath, subscriberId);
      return true;
    } catch {
      return false;
    }
  }

  function unwatchFile(filePath, subscriberId) {
    const entry = entries.get(filePath);
    if (!entry) {
      unbindSubscriber(filePath, subscriberId);
      return true;
    }
    entry.subscribers.delete(subscriberId);
    unbindSubscriber(filePath, subscriberId);
    if (entry.subscribers.size === 0) {
      closeEntry(filePath, entry);
    }
    return true;
  }

  function unwatchAllForSubscriber(subscriberId) {
    const files = filesBySubscriber.get(subscriberId);
    if (!files) return;
    for (const filePath of [...files]) {
      unwatchFile(filePath, subscriberId);
    }
  }

  return {
    watchFile,
    unwatchFile,
    unwatchAllForSubscriber,
  };
}

module.exports = { createFileWatchRegistry };
