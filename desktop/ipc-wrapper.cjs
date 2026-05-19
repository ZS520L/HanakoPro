const { ipcMain } = require('electron');

function normalizeIpcError(err) {
  return err instanceof Error ? err : new Error(String(err));
}

function logIpcError(channel, err) {
  const traceId = Math.random().toString(16).slice(2, 10);
  console.error(`[IPC][${channel}][${traceId}] ${err?.message || err}`, err);
  return traceId;
}

/**
 * Strict IPC handler wrapper.
 * Preserves invoke/handle semantics: successful handlers resolve their value,
 * unexpected handler errors are logged and rejected back to the renderer.
 */
function wrapIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      logIpcError(channel, err);
      throw normalizeIpcError(err);
    }
  });
}

/**
 * Best-effort IPC handler wrapper.
 * Use for fire-and-forget UI actions where we only want structured logging
 * and explicitly do not expose failures as invoke rejections.
 */
function wrapIpcBestEffortHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      logIpcError(channel, err);
      return undefined;
    }
  });
}

function wrapIpcOn(channel, handler) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      const result = handler(event, ...args);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          console.error(`[IPC][${channel}] async: ${err?.message || err}`);
        });
      }
    } catch (err) {
      console.error(`[IPC][${channel}] ${err?.message || err}`);
    }
  });
}

module.exports = { wrapIpcHandler, wrapIpcBestEffortHandler, wrapIpcOn };
