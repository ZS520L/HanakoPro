import { describe, expect, it } from "vitest";
import {
  durableDesktopPetState,
  mapDesktopPetEventToState,
  normalizeDesktopPetState,
  resolveDesktopPetBounds,
  VALID_MOODS,
} from "../desktop/src/shared/desktop-pet-state.cjs";

describe("desktop pet state", () => {
  it("normalizes unsafe persisted values", () => {
    expect(normalizeDesktopPetState({
      enabled: false,
      visible: true,
      scale: 99,
      backgroundOnly: false,
      width: 1,
      height: 9999,
      mood: "unknown",
      message: "x".repeat(200),
    })).toEqual(expect.objectContaining({
      enabled: false,
      visible: true,
      scale: 2,
      backgroundOnly: false,
      width: 280,
      height: 560,
      mood: "idle",
    }));
  });

  it("falls back to the primary work area when saved bounds are off-screen", () => {
    const bounds = resolveDesktopPetBounds(
      { x: 9000, y: 9000, width: 280, height: 380 },
      [{ x: 0, y: 0, width: 1280, height: 720 }],
      { x: 0, y: 0, width: 1280, height: 720 },
    );

    expect(bounds).toEqual({ x: 968, y: 292, width: 280, height: 380 });
  });

  it("keeps the larger interactive pet window inside the work area", () => {
    const bounds = resolveDesktopPetBounds(
      { x: 1100, y: 650, width: 220, height: 280 },
      [{ x: 0, y: 0, width: 1280, height: 720 }],
      { x: 0, y: 0, width: 1280, height: 720 },
    );

    expect(bounds).toEqual({ x: 1000, y: 340, width: 280, height: 380 });
  });

  it("persists the background-only pet preference", () => {
    expect(normalizeDesktopPetState({}).backgroundOnly).toBe(false);
    expect(durableDesktopPetState({ backgroundOnly: true })).toEqual(expect.objectContaining({
      backgroundOnly: true,
    }));
  });

  it("accepts all desktop pet image moods", () => {
    expect([...VALID_MOODS]).toEqual(expect.arrayContaining([
      "idle",
      "thinking",
      "talking",
      "working",
      "happy",
      "error",
      "cute",
      "sad",
      "missing",
    ]));
    expect(normalizeDesktopPetState({ mood: "cute" }).mood).toBe("cute");
    expect(normalizeDesktopPetState({ mood: "sad" }).mood).toBe("sad");
    expect(normalizeDesktopPetState({ mood: "missing" }).mood).toBe("missing");
  });

  it("normalizes and persists custom mood images", () => {
    const state = normalizeDesktopPetState({
      customImages: {
        idle: " C:\\pets\\idle.png ",
        cute: "C:\\pets\\cute.webp",
        unknown: "C:\\pets\\unknown.png",
        sad: "",
      },
    });

    expect(state.customImages).toEqual({
      idle: "C:\\pets\\idle.png",
      cute: "C:\\pets\\cute.webp",
    });
    expect(durableDesktopPetState(state).customImages).toEqual(state.customImages);
  });

  it("maps stream and tool events to pet moods", () => {
    expect(mapDesktopPetEventToState({ type: "thinking_start" })).toEqual({ mood: "thinking", message: "思考中" });
    expect(mapDesktopPetEventToState({ type: "text_delta", delta: "这段内容不应该展示出来" })).toEqual({ mood: "talking", message: "回复中" });
    expect(mapDesktopPetEventToState({ type: "tool_start", name: "write_file" })).toEqual({ mood: "working", message: "编辑中" });
    expect(mapDesktopPetEventToState({ type: "tool_start", name: "bash" })).toEqual({ mood: "working", message: "执行中" });
    expect(mapDesktopPetEventToState({ type: "tool_end", name: "write_file", success: false })).toEqual({ mood: "error", message: "遇到问题" });
    expect(mapDesktopPetEventToState({ type: "turn_end" })).toEqual({ mood: "idle", message: "待机中" });
  });
});
