import { beforeEach, describe, expect, it, vi } from 'vitest';

let registeredHandle = null;
let registeredOn = null;

const ipcMain = {
  handle: vi.fn((channel, handler) => {
    registeredHandle = { channel, handler };
  }),
  on: vi.fn((channel, handler) => {
    registeredOn = { channel, handler };
  }),
};

vi.mock('electron', () => ({ ipcMain }));

describe('ipc-wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandle = null;
    registeredOn = null;
  });

  it('wrapIpcHandler keeps invoke/handle failure semantics and rejects escaped errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapIpcHandler } = await import('../desktop/ipc-wrapper.cjs');

    wrapIpcHandler('strict-demo', async () => {
      throw new Error('boom');
    });

    await expect(registeredHandle.handler({}, 'arg')).rejects.toThrow('boom');
    expect(registeredHandle.channel).toBe('strict-demo');
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it('wrapIpcBestEffortHandler logs escaped errors and resolves undefined', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapIpcBestEffortHandler } = await import('../desktop/ipc-wrapper.cjs');

    wrapIpcBestEffortHandler('best-effort-demo', async () => {
      throw new Error('soft-fail');
    });

    await expect(registeredHandle.handler({}, 'arg')).resolves.toBeUndefined();
    expect(registeredHandle.channel).toBe('best-effort-demo');
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it('wrapIpcOn still traps async listener rejections without crashing the sender path', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapIpcOn } = await import('../desktop/ipc-wrapper.cjs');

    wrapIpcOn('listener-demo', async () => {
      throw new Error('listener-fail');
    });

    registeredOn.handler({}, 'arg');
    await Promise.resolve();

    expect(registeredOn.channel).toBe('listener-demo');
    expect(consoleSpy).toHaveBeenCalledOnce();
  });
});
