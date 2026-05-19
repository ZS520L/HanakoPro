import fs from "fs";
import path from "path";

/**
 * TaskRegistry — plugin-safe background task registry.
 *
 * Runtime handlers stay in memory because they are plugin functions. Task and
 * schedule metadata can be persisted so the host can show diagnostics and let
 * plugins recover work after restart.
 */

const ACTIVE_STATUSES = new Set(["pending", "running", "paused", "blocked", "recovering"]);
const FINAL_STATUSES = new Set(["completed", "failed", "canceled", "aborted"]);
const KNOWN_STATUSES = new Set([...ACTIVE_STATUSES, ...FINAL_STATUSES]);
const MAX_TIMER_DELAY = 2_147_483_647;

export class TaskRegistry {
  constructor(options = {}) {
    this._persistencePath = typeof options.persistencePath === "string" ? options.persistencePath : null;
    /** @type {Map<string, { abort: (taskId: string) => void, run?: Function }>} */
    this._handlers = new Map();
    /** @type {Map<string, object>} */
    this._tasks = new Map();
    /** @type {Map<string, object>} */
    this._schedules = new Map();
    /** @type {Map<string, NodeJS.Timeout>} */
    this._scheduleTimers = new Map();
    this._loadPersisted();
  }

  // ── 类型处理器注册（启动时调用） ──

  registerHandler(type, handler) {
    const key = assertText(type, "task handler type");
    if (!handler?.abort || typeof handler.abort !== "function") {
      throw new Error(`TaskRegistry: handler for "${key}" must have an abort(taskId) method`);
    }
    if (handler.run !== undefined && typeof handler.run !== "function") {
      throw new Error(`TaskRegistry: handler for "${key}" run must be a function`);
    }
    this._handlers.set(key, handler);
    this._armSchedulesForType(key);
  }

  unregisterHandler(type) {
    this._handlers.delete(type);
  }

  // ── 任务实例生命周期 ──

  register(taskId, { type, parentSessionPath = null, meta = {}, pluginId = null, agentId = null, persist = true } = {}) {
    const id = assertText(taskId, "taskId");
    const taskType = assertText(type, "task type");
    if (!this._handlers.has(taskType)) {
      console.warn(`[task-registry] no handler for type "${taskType}", task ${id} registered without abort support`);
    }
    const existing = this._tasks.get(id);
    const now = Date.now();
    const task = {
      taskId: id,
      type: taskType,
      parentSessionPath: parentSessionPath || null,
      pluginId: pluginId || existing?.pluginId || null,
      agentId: agentId || existing?.agentId || null,
      meta: objectOrEmpty(existing?.meta),
      progress: existing?.progress || null,
      status: normalizeStatus(existing?.status, "running"),
      aborted: Boolean(existing?.aborted),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      persist: persist !== false,
    };
    task.meta = { ...task.meta, ...objectOrEmpty(meta) };
    if (FINAL_STATUSES.has(task.status)) {
      task.status = "running";
      task.aborted = false;
      delete task.completedAt;
      delete task.error;
      delete task.result;
    }
    this._tasks.set(id, task);
    this._persist();
    return clone(task);
  }

  update(taskId, patch = {}) {
    const task = this._requireTask(taskId);
    const now = Date.now();
    const next = {
      ...task,
      updatedAt: now,
    };
    if (patch.status !== undefined) next.status = normalizeStatus(patch.status, task.status);
    if (patch.progress !== undefined) next.progress = normalizeProgress(patch.progress);
    if (patch.meta !== undefined) next.meta = { ...objectOrEmpty(task.meta), ...objectOrEmpty(patch.meta) };
    if (patch.result !== undefined) next.result = patch.result;
    if (patch.error !== undefined) next.error = normalizeError(patch.error);
    if (patch.parentSessionPath !== undefined) next.parentSessionPath = patch.parentSessionPath || null;
    if (patch.agentId !== undefined) next.agentId = patch.agentId || null;
    if (patch.pluginId !== undefined) next.pluginId = patch.pluginId || null;
    this._tasks.set(task.taskId, next);
    this._persist();
    return clone(next);
  }

  complete(taskId, result = null) {
    const task = this._requireTask(taskId);
    const now = Date.now();
    const next = {
      ...task,
      status: "completed",
      result,
      updatedAt: now,
      completedAt: now,
    };
    delete next.error;
    this._tasks.set(task.taskId, next);
    this._persist();
    return clone(next);
  }

  fail(taskId, error = "failed") {
    const task = this._requireTask(taskId);
    const now = Date.now();
    const next = {
      ...task,
      status: "failed",
      error: normalizeError(error),
      updatedAt: now,
      completedAt: now,
    };
    this._tasks.set(task.taskId, next);
    this._persist();
    return clone(next);
  }

  cancel(taskId, reason = "canceled") {
    const result = this.abort(taskId);
    if (result === "aborted" || result === "already_aborted") {
      const task = this._requireTask(taskId);
      const now = Date.now();
      const next = {
        ...task,
        status: "canceled",
        error: normalizeError(reason),
        aborted: true,
        updatedAt: now,
        completedAt: now,
      };
      this._tasks.set(task.taskId, next);
      this._persist();
      return { result, canceled: true };
    }
    return { result, canceled: false };
  }

  abort(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return "not_found";
    if (task.aborted) return "already_aborted";

    const handler = this._handlers.get(task.type);
    if (!handler) return "no_handler";

    task.aborted = true;
    task.status = "aborted";
    task.updatedAt = Date.now();
    task.completedAt = task.updatedAt;
    try { handler.abort(taskId); } catch (err) {
      console.error(`[task-registry] abort handler error for ${taskId}:`, err.message);
    }
    this._persist();
    return "aborted";
  }

  remove(taskId) {
    this._tasks.delete(taskId);
    this._persist();
  }

  query(taskId) {
    const task = this._tasks.get(taskId);
    return task ? clone(task) : null;
  }

  listByType(type) {
    const result = [];
    for (const task of this._tasks.values()) {
      if (task.type === type) result.push(clone(task));
    }
    return result;
  }

  listAll(filter = {}) {
    const tasks = [...this._tasks.values()].filter((task) => {
      if (filter.type && task.type !== filter.type) return false;
      if (filter.status && task.status !== filter.status) return false;
      if (filter.pluginId && task.pluginId !== filter.pluginId) return false;
      if (filter.parentSessionPath && task.parentSessionPath !== filter.parentSessionPath) return false;
      return true;
    });
    return tasks.map(clone);
  }

  // ── 计划任务 ──

  schedule(scheduleId, input = {}) {
    const id = assertText(scheduleId, "scheduleId");
    const type = assertText(input.type, "schedule type");
    const existing = this._schedules.get(id);
    const now = Date.now();
    const intervalMs = input.intervalMs === undefined ? existing?.intervalMs : normalizePositiveNumber(input.intervalMs, "intervalMs");
    const runAt = input.runAt === undefined ? existing?.runAt : normalizeOptionalTime(input.runAt, "runAt");
    if (!intervalMs && !runAt) {
      throw new Error("TaskRegistry: schedule requires intervalMs or runAt");
    }
    const enabled = input.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled);
    const nextRunAt = enabled ? resolveNextRunAt({ intervalMs, runAt, existing, now }) : null;
    const schedule = {
      scheduleId: id,
      type,
      pluginId: input.pluginId || existing?.pluginId || null,
      agentId: input.agentId || existing?.agentId || null,
      parentSessionPath: input.parentSessionPath || existing?.parentSessionPath || null,
      payload: input.payload === undefined ? clone(existing?.payload || {}) : clone(input.payload),
      meta: input.meta === undefined ? clone(existing?.meta || {}) : objectOrEmpty(input.meta),
      intervalMs: intervalMs || null,
      runAt: runAt || null,
      enabled,
      nextRunAt,
      lastRunAt: existing?.lastRunAt || null,
      lastResult: existing?.lastResult,
      lastError: existing?.lastError || null,
      runCount: existing?.runCount || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this._schedules.set(id, schedule);
    this._persist();
    this._armSchedule(id);
    return clone(schedule);
  }

  unschedule(scheduleId) {
    const id = assertText(scheduleId, "scheduleId");
    this._clearScheduleTimer(id);
    const deleted = this._schedules.delete(id);
    this._persist();
    return deleted;
  }

  querySchedule(scheduleId) {
    const schedule = this._schedules.get(scheduleId);
    return schedule ? clone(schedule) : null;
  }

  listSchedules(filter = {}) {
    return [...this._schedules.values()]
      .filter((schedule) => {
        if (filter.type && schedule.type !== filter.type) return false;
        if (filter.pluginId && schedule.pluginId !== filter.pluginId) return false;
        if (filter.enabled !== undefined && schedule.enabled !== Boolean(filter.enabled)) return false;
        return true;
      })
      .map(clone);
  }

  clearTimers() {
    for (const scheduleId of this._scheduleTimers.keys()) {
      this._clearScheduleTimer(scheduleId);
    }
  }

  _requireTask(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) throw new Error(`TaskRegistry: task "${taskId}" not found`);
    return task;
  }

  _armSchedulesForType(type) {
    for (const schedule of this._schedules.values()) {
      if (schedule.type === type) this._armSchedule(schedule.scheduleId);
    }
  }

  _armSchedule(scheduleId) {
    this._clearScheduleTimer(scheduleId);
    const schedule = this._schedules.get(scheduleId);
    if (!schedule?.enabled || !schedule.nextRunAt) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY, schedule.nextRunAt - Date.now()));
    const timer = setTimeout(() => {
      this._scheduleTimers.delete(scheduleId);
      this._runSchedule(scheduleId).catch((err) => {
        console.error(`[task-registry] schedule ${scheduleId} failed:`, err.message);
      });
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    this._scheduleTimers.set(scheduleId, timer);
  }

  _clearScheduleTimer(scheduleId) {
    const timer = this._scheduleTimers.get(scheduleId);
    if (timer) clearTimeout(timer);
    this._scheduleTimers.delete(scheduleId);
  }

  async _runSchedule(scheduleId) {
    const schedule = this._schedules.get(scheduleId);
    if (!schedule?.enabled) return;
    const handler = this._handlers.get(schedule.type);
    if (!handler?.run) {
      schedule.lastError = `No schedule runner for type "${schedule.type}"`;
      schedule.updatedAt = Date.now();
      this._persist();
      return;
    }

    const now = Date.now();
    try {
      const result = await handler.run(clone(schedule));
      schedule.lastRunAt = now;
      schedule.lastResult = result ?? null;
      schedule.lastError = null;
      schedule.runCount = (schedule.runCount || 0) + 1;
      if (schedule.intervalMs) {
        schedule.nextRunAt = now + schedule.intervalMs;
      } else {
        schedule.enabled = false;
        schedule.nextRunAt = null;
      }
    } catch (err) {
      schedule.lastRunAt = now;
      schedule.lastError = normalizeError(err);
      if (schedule.intervalMs) {
        schedule.nextRunAt = now + schedule.intervalMs;
      } else {
        schedule.enabled = false;
        schedule.nextRunAt = null;
      }
    } finally {
      schedule.updatedAt = Date.now();
      this._schedules.set(scheduleId, schedule);
      this._persist();
      this._armSchedule(scheduleId);
    }
  }

  _loadPersisted() {
    if (!this._persistencePath || !fs.existsSync(this._persistencePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this._persistencePath, "utf8"));
      for (const task of Array.isArray(raw.tasks) ? raw.tasks : []) {
        if (!task?.taskId || !task?.type) continue;
        const restored = { ...task };
        if (ACTIVE_STATUSES.has(restored.status)) {
          restored.status = "recovering";
          restored.updatedAt = Date.now();
        }
        this._tasks.set(restored.taskId, restored);
      }
      for (const schedule of Array.isArray(raw.schedules) ? raw.schedules : []) {
        if (!schedule?.scheduleId || !schedule?.type) continue;
        this._schedules.set(schedule.scheduleId, { ...schedule });
        this._armSchedule(schedule.scheduleId);
      }
    } catch (err) {
      console.warn(`[task-registry] failed to load persisted tasks: ${err.message}`);
    }
  }

  _persist() {
    if (!this._persistencePath) return;
    try {
      fs.mkdirSync(path.dirname(this._persistencePath), { recursive: true });
      const tasks = [...this._tasks.values()]
        .filter((task) => task.persist !== false)
        .map(stripRuntimeTaskFields);
      const schedules = [...this._schedules.values()];
      fs.writeFileSync(this._persistencePath, JSON.stringify({ tasks, schedules }, null, 2));
    } catch (err) {
      console.warn(`[task-registry] failed to persist tasks: ${err.message}`);
    }
  }
}

function assertText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`TaskRegistry: ${label} is required`);
  return text;
}

function normalizeStatus(value, fallback) {
  const status = typeof value === "string" ? value.trim() : "";
  if (!status) return fallback;
  if (!KNOWN_STATUSES.has(status)) {
    throw new Error(`TaskRegistry: unknown task status "${status}"`);
  }
  return status;
}

function normalizeProgress(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TaskRegistry: progress must be an object or null");
  }
  const current = normalizeOptionalNumber(value.current, "progress.current");
  const total = normalizeOptionalNumber(value.total, "progress.total");
  const percent = value.percent !== undefined
    ? normalizeOptionalNumber(value.percent, "progress.percent")
    : derivePercent(current, total);
  return {
    ...(current !== undefined ? { current } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(percent !== undefined ? { percent } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function normalizeOptionalNumber(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`TaskRegistry: ${label} must be a finite number`);
  return number;
}

function normalizePositiveNumber(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`TaskRegistry: ${label} must be a positive number`);
  }
  return number;
}

function normalizeOptionalTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.getTime();
  const number = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(number)) throw new Error(`TaskRegistry: ${label} must be a valid time`);
  return number;
}

function derivePercent(current, total) {
  if (current === undefined || total === undefined || total <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return String(error);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stripRuntimeTaskFields(task) {
  const { persist: _persist, ...rest } = task;
  return rest;
}

function resolveNextRunAt({ intervalMs, runAt, existing, now }) {
  if (existing?.nextRunAt && existing.nextRunAt > now) return existing.nextRunAt;
  if (runAt) return runAt;
  return now + intervalMs;
}
