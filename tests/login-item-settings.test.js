import { describe, expect, it, vi } from "vitest";

async function loadModule() {
  const mod = await import("../desktop/login-item-settings.cjs");
  return mod.default || mod;
}

function createAppMock(settings = {}) {
  return {
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, ...settings })),
    setLoginItemSettings: vi.fn(),
  };
}

describe("login item settings", () => {
  it("uses a dedicated login-start argument on Windows so startup can stay hidden", async () => {
    const { START_AT_LOGIN_ARG, getLoginItemOptions, wasLaunchedAtLogin } = await loadModule();

    expect(getLoginItemOptions("win32", "C:\\Program Files\\Hanako\\Hanako.exe")).toEqual({
      path: "C:\\Program Files\\Hanako\\Hanako.exe",
      args: [START_AT_LOGIN_ARG],
    });
    expect(wasLaunchedAtLogin({
      platform: "win32",
      argv: ["Hanako.exe", START_AT_LOGIN_ARG],
      loginItemSettings: {},
    })).toBe(true);
  });

  it("reads macOS login launch state from Electron login item settings", async () => {
    const { wasLaunchedAtLogin } = await loadModule();

    expect(wasLaunchedAtLogin({
      platform: "darwin",
      argv: ["Hanako"],
      loginItemSettings: { wasOpenedAtLogin: true },
    })).toBe(true);
  });

  it("reports Linux as unsupported without touching Electron login item APIs", async () => {
    const { getAutoLaunchStatus } = await loadModule();
    const app = createAppMock();

    expect(getAutoLaunchStatus({ app, platform: "linux", argv: [], execPath: "/opt/Hanako/hanako" })).toEqual({
      supported: false,
      openAtLogin: false,
      openedAtLogin: false,
      status: "unsupported",
    });
    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
  });

  it("writes and re-reads Windows login item settings with the same path and args", async () => {
    const { START_AT_LOGIN_ARG, setAutoLaunchEnabled } = await loadModule();
    const app = createAppMock({ openAtLogin: true, executableWillLaunchAtLogin: true });

    const status = setAutoLaunchEnabled({
      app,
      platform: "win32",
      argv: [],
      execPath: "C:\\Hanako\\Hanako.exe",
      enabled: true,
    });

    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: "C:\\Hanako\\Hanako.exe",
      args: [START_AT_LOGIN_ARG],
    });
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({
      path: "C:\\Hanako\\Hanako.exe",
      args: [START_AT_LOGIN_ARG],
    });
    expect(status).toMatchObject({
      supported: true,
      openAtLogin: true,
      openedAtLogin: false,
      executableWillLaunchAtLogin: true,
    });
  });
});
