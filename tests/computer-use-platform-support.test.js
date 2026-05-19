import { describe, expect, it } from "vitest";
import {
  effectiveComputerUseSettings,
  isComputerUsePlatformSupported,
  selectedComputerProviderId,
} from "../core/computer-use/platform-support.js";

const baseSettings = {
  enabled: true,
  provider_by_platform: {
    darwin: "macos:cua",
    win32: "windows:uia",
    linux: "mock",
  },
  allow_windows_input_injection: false,
  app_approvals: [],
};

describe("Computer Use platform support", () => {
  it("supports only macOS and Windows", () => {
    expect(isComputerUsePlatformSupported("darwin")).toBe(true);
    expect(isComputerUsePlatformSupported("win32")).toBe(true);
    expect(isComputerUsePlatformSupported("linux")).toBe(false);
  });

  it("forces Linux Computer Use settings to disabled without mutating stored provider choices", () => {
    const effective = effectiveComputerUseSettings(baseSettings, { platform: "linux" });

    expect(effective.enabled).toBe(false);
    expect(effective.provider_by_platform.linux).toBe("mock");
    expect(baseSettings.enabled).toBe(true);
    expect(selectedComputerProviderId(effective, { platform: "linux" })).toBeNull();
  });
});
