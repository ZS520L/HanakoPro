import { describe, expect, it, vi } from "vitest";

import { emitAppEvent, toAppEventWsMessage } from "../server/app-events.js";

describe("app-events", () => {
  it("emitAppEvent emits a null-scoped app_event through engine.emitEvent", () => {
    const engine = { emitEvent: vi.fn() };

    emitAppEvent(engine, "models-changed", { reason: "provider" });

    expect(engine.emitEvent).toHaveBeenCalledWith({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: { reason: "provider" },
        source: "server",
      },
    }, null);
  });

  it("emitAppEvent ignores non-string and empty string event types", () => {
    const engine = { emitEvent: vi.fn() };

    emitAppEvent(engine, "");
    emitAppEvent(engine, null);
    emitAppEvent(engine, 123);

    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("emitAppEvent defaults missing payload to empty object", () => {
    const engine = { emitEvent: vi.fn() };

    emitAppEvent(engine, "models-changed");
    emitAppEvent(engine, "theme-changed", undefined);

    expect(engine.emitEvent).toHaveBeenNthCalledWith(1, {
      type: "app_event",
      event: {
        type: "models-changed",
        payload: {},
        source: "server",
      },
    }, null);
    expect(engine.emitEvent).toHaveBeenNthCalledWith(2, {
      type: "app_event",
      event: {
        type: "theme-changed",
        payload: {},
        source: "server",
      },
    }, null);
  });

  it("emitAppEvent does not emit malformed payloads", () => {
    const engine = { emitEvent: vi.fn() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const payload of [["provider"], null, 123, "provider"]) {
      emitAppEvent(engine, "models-changed", payload);
    }

    expect(engine.emitEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid payload"));
    warn.mockRestore();
  });

  it("toAppEventWsMessage maps a valid app_event to a websocket message", () => {
    expect(toAppEventWsMessage({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: { reason: "provider" },
        source: "settings",
      },
    })).toEqual({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: { reason: "provider" },
        source: "settings",
      },
    });
  });

  it("toAppEventWsMessage defaults missing payload to empty object", () => {
    expect(toAppEventWsMessage({
      type: "app_event",
      event: {
        type: "models-changed",
        source: "settings",
      },
    })).toEqual({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: {},
        source: "settings",
      },
    });
    expect(toAppEventWsMessage({
      type: "app_event",
      event: {
        type: "theme-changed",
        payload: undefined,
        source: "settings",
      },
    })).toEqual({
      type: "app_event",
      event: {
        type: "theme-changed",
        payload: {},
        source: "settings",
      },
    });
  });

  it("toAppEventWsMessage does not forward malformed payloads", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const payload of [["provider"], null, 123, "provider"]) {
      expect(toAppEventWsMessage({
        type: "app_event",
        event: {
          type: "models-changed",
          payload,
          source: "settings",
        },
      })).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid payload"));
    warn.mockRestore();
  });

  it("toAppEventWsMessage defaults missing source to server", () => {
    expect(toAppEventWsMessage({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: { reason: "provider" },
      },
    })).toEqual({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: { reason: "provider" },
        source: "server",
      },
    });
  });

  it("toAppEventWsMessage returns null for invalid source", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toAppEventWsMessage({
      type: "app_event",
      event: {
        type: "models-changed",
        payload: {},
        source: "",
      },
    })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid source"));
    warn.mockRestore();
  });

  it("toAppEventWsMessage returns null for malformed app_event and non app_event", () => {
    expect(toAppEventWsMessage({ type: "desk_changed" })).toBeNull();
    expect(toAppEventWsMessage({ type: "app_event" })).toBeNull();
    expect(toAppEventWsMessage({ type: "app_event", event: { type: "" } })).toBeNull();
  });
});
