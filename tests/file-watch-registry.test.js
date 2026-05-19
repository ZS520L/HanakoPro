import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFileWatchRegistry } from "../desktop/file-watch-registry.cjs";

describe("file-watch-registry", () => {
  let watchMock;
  let callbacks;
  let closeFns;
  let notified;

  beforeEach(() => {
    callbacks = new Map();
    closeFns = new Map();
    notified = [];
    watchMock = vi.fn((filePath, _opts, cb) => {
      callbacks.set(filePath, cb);
      const close = vi.fn();
      closeFns.set(filePath, close);
      return { close };
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一文件被多个 subscriber watch 时，只创建一个底层 watcher 并通知所有订阅者", () => {
    const registry = createFileWatchRegistry({
      watch: watchMock,
      notifySubscriber: (subscriberId, filePath) => notified.push({ subscriberId, filePath }),
    });

    expect(registry.watchFile("/tmp/a.txt", 1)).toBe(true);
    expect(registry.watchFile("/tmp/a.txt", 2)).toBe(true);
    expect(watchMock).toHaveBeenCalledTimes(1);

    callbacks.get("/tmp/a.txt")("change");
    vi.advanceTimersByTime(60);

    expect(notified).toEqual([
      { subscriberId: 1, filePath: "/tmp/a.txt" },
      { subscriberId: 2, filePath: "/tmp/a.txt" },
    ]);
  });

  it("移除一个 subscriber 时不会关闭仍被其他 subscriber 使用的 watcher", () => {
    const registry = createFileWatchRegistry({
      watch: watchMock,
      notifySubscriber: () => {},
    });

    registry.watchFile("/tmp/a.txt", 1);
    registry.watchFile("/tmp/a.txt", 2);

    expect(registry.unwatchFile("/tmp/a.txt", 1)).toBe(true);
    expect(closeFns.get("/tmp/a.txt")).not.toHaveBeenCalled();

    expect(registry.unwatchFile("/tmp/a.txt", 2)).toBe(true);
    expect(closeFns.get("/tmp/a.txt")).toHaveBeenCalledOnce();
  });

  it("unwatchAllForSubscriber 只移除该 subscriber，不影响其他文件/订阅者", () => {
    const registry = createFileWatchRegistry({
      watch: watchMock,
      notifySubscriber: () => {},
    });

    registry.watchFile("/tmp/a.txt", 1);
    registry.watchFile("/tmp/b.txt", 1);
    registry.watchFile("/tmp/b.txt", 2);

    registry.unwatchAllForSubscriber(1);

    expect(closeFns.get("/tmp/a.txt")).toHaveBeenCalledOnce();
    expect(closeFns.get("/tmp/b.txt")).not.toHaveBeenCalled();

    callbacks.get("/tmp/b.txt")("rename");
    vi.advanceTimersByTime(60);
  });

  it("底层 watch 创建失败时返回 false，且不会留下脏状态", () => {
    const registry = createFileWatchRegistry({
      watch: vi.fn(() => { throw new Error("watch failed"); }),
      notifySubscriber: () => {},
    });

    expect(registry.watchFile("/tmp/a.txt", 1)).toBe(false);
    expect(registry.unwatchFile("/tmp/a.txt", 1)).toBe(true);
  });
});
