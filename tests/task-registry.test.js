import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { TaskRegistry } from "../lib/task-registry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskRegistry", () => {
  it("registerHandler validates abort method", () => {
    const reg = new TaskRegistry();
    expect(() => reg.registerHandler("test", {})).toThrow("must have an abort");
    expect(() => reg.registerHandler("test", { abort: "not a fn" })).toThrow("must have an abort");
  });

  it("register + query returns task info", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("test", { abort: vi.fn() });
    reg.register("t1", { type: "test", parentSessionPath: "/p1" });
    const task = reg.query("t1");
    expect(task).toBeTruthy();
    expect(task.type).toBe("test");
    expect(task.parentSessionPath).toBe("/p1");
    expect(task.aborted).toBe(false);
  });

  it("abort dispatches to handler and returns 'aborted'", () => {
    const reg = new TaskRegistry();
    const abortFn = vi.fn();
    reg.registerHandler("test", { abort: abortFn });
    reg.register("t1", { type: "test", parentSessionPath: "/p1" });
    const result = reg.abort("t1");
    expect(result).toBe("aborted");
    expect(abortFn).toHaveBeenCalledWith("t1");
    expect(reg.query("t1").aborted).toBe(true);
  });

  it("abort with no handler returns 'no_handler'", () => {
    const reg = new TaskRegistry();
    // register task without registering handler first
    reg.register("t1", { type: "unknown", parentSessionPath: "/p1" });
    expect(reg.abort("t1")).toBe("no_handler");
  });

  it("abort on unknown taskId returns 'not_found'", () => {
    const reg = new TaskRegistry();
    expect(reg.abort("nope")).toBe("not_found");
  });

  it("double abort returns 'already_aborted'", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("test", { abort: vi.fn() });
    reg.register("t1", { type: "test", parentSessionPath: "/p1" });
    reg.abort("t1");
    expect(reg.abort("t1")).toBe("already_aborted");
  });

  it("remove cleans up the task", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("test", { abort: vi.fn() });
    reg.register("t1", { type: "test", parentSessionPath: "/p1" });
    reg.remove("t1");
    expect(reg.query("t1")).toBeNull();
  });

  it("unregisterHandler removes handler", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("test", { abort: vi.fn() });
    reg.unregisterHandler("test");
    reg.register("t1", { type: "test", parentSessionPath: "/p1" });
    expect(reg.abort("t1")).toBe("no_handler");
  });

  it("listByType filters by type", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("a", { abort: vi.fn() });
    reg.registerHandler("b", { abort: vi.fn() });
    reg.register("t1", { type: "a", parentSessionPath: "/p1" });
    reg.register("t2", { type: "b", parentSessionPath: "/p2" });
    reg.register("t3", { type: "a", parentSessionPath: "/p3" });
    const aList = reg.listByType("a");
    expect(aList).toHaveLength(2);
    expect(aList.map(t => t.taskId)).toEqual(["t1", "t3"]);
  });

  it("listAll returns all tasks", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("a", { abort: vi.fn() });
    reg.register("t1", { type: "a", parentSessionPath: "/p1" });
    reg.register("t2", { type: "a", parentSessionPath: "/p2" });
    expect(reg.listAll()).toHaveLength(2);
  });

  it("update, complete, and fail keep explicit task state", () => {
    const reg = new TaskRegistry();
    reg.registerHandler("render", { abort: vi.fn() });
    reg.register("t1", { type: "render", parentSessionPath: "/s/a", meta: { prompt: "a" } });

    reg.update("t1", {
      status: "running",
      progress: { current: 2, total: 4, message: "half" },
      meta: { model: "image" },
    });

    expect(reg.query("t1")).toMatchObject({
      status: "running",
      progress: { current: 2, total: 4, percent: 50, message: "half" },
      meta: { prompt: "a", model: "image" },
    });

    reg.complete("t1", { url: "file.png" });
    expect(reg.query("t1")).toMatchObject({
      status: "completed",
      result: { url: "file.png" },
    });

    reg.register("t2", { type: "render", parentSessionPath: "/s/a" });
    reg.fail("t2", "network");
    expect(reg.query("t2")).toMatchObject({
      status: "failed",
      error: "network",
    });
  });

  it("cancel delegates to abort handler and marks canceled tasks", () => {
    const reg = new TaskRegistry();
    const abortFn = vi.fn();
    reg.registerHandler("render", { abort: abortFn });
    reg.register("t1", { type: "render", parentSessionPath: "/s/a" });

    expect(reg.cancel("t1", "user")).toEqual({ result: "aborted", canceled: true });
    expect(abortFn).toHaveBeenCalledWith("t1");
    expect(reg.query("t1")).toMatchObject({
      status: "canceled",
      aborted: true,
      error: "user",
    });
  });

  it("persists tasks and restores active tasks as recovering", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-task-registry-"));
    const persistencePath = path.join(dir, "tasks.json");

    const reg = new TaskRegistry({ persistencePath });
    reg.registerHandler("render", { abort: vi.fn() });
    reg.register("t1", { type: "render", parentSessionPath: "/s/a", meta: { prompt: "a" } });
    reg.update("t1", { progress: { current: 1, total: 4 } });

    const restored = new TaskRegistry({ persistencePath });
    expect(restored.query("t1")).toMatchObject({
      type: "render",
      parentSessionPath: "/s/a",
      status: "recovering",
      progress: { current: 1, total: 4, percent: 25 },
      meta: { prompt: "a" },
    });
  });

  it("runs persisted schedules when their handler is registered", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-task-schedules-"));
    const persistencePath = path.join(dir, "tasks.json");

    const first = new TaskRegistry({ persistencePath });
    first.schedule("daily", {
      type: "digest",
      intervalMs: 1000,
      payload: { agentId: "a" },
    });

    const run = vi.fn(async () => ({ ok: true }));
    const restored = new TaskRegistry({ persistencePath });
    restored.registerHandler("digest", { abort: vi.fn(), run });

    await vi.advanceTimersByTimeAsync(1000);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: "daily",
      type: "digest",
      payload: { agentId: "a" },
    }));
    expect(restored.querySchedule("daily")).toMatchObject({
      enabled: true,
      runCount: 1,
      lastResult: { ok: true },
    });
    restored.clearTimers();
  });
});
