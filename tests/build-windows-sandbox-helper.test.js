import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildWindowsSandboxBatchScript,
  buildWindowsSandboxCompileCommand,
  shouldBuildWindowsSandboxHelper,
  windowsSandboxHelperOutputDir,
} from "../scripts/build-windows-sandbox-helper.mjs";

describe("Windows sandbox helper build script", () => {
  it("only builds on win32", () => {
    expect(shouldBuildWindowsSandboxHelper({ platform: "darwin" })).toBe(false);
    expect(shouldBuildWindowsSandboxHelper({ platform: "linux" })).toBe(false);
    expect(shouldBuildWindowsSandboxHelper({ platform: "win32" })).toBe(true);
  });

  it("writes the helper into the Electron extraResources source directory", () => {
    expect(windowsSandboxHelperOutputDir({
      rootDir: "/repo",
      arch: "x64",
    })).toBe(path.join("/repo", "dist-sandbox", "win-x64"));
  });

  it("links the Win32 libraries required by AppContainer and ACL APIs", () => {
    const command = buildWindowsSandboxCompileCommand({
      source: "C:\\repo\\desktop\\native\\HanaWindowsSandboxHelper\\main.cpp",
      output: "C:\\repo\\dist-sandbox\\win-x64\\hana-win-sandbox.exe",
    });

    expect(command).toContain("cl.exe");
    expect(command).toContain("userenv.lib");
    expect(command).toContain("advapi32.lib");
  });

  it("writes a batch script that calls VsDevCmd.bat before cl.exe", () => {
    const script = buildWindowsSandboxBatchScript({
      devCmd: "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat",
      compileCommand: "cl.exe /nologo main.cpp",
      arch: "x64",
    });

    expect(script).toBe([
      "@echo off",
      'call "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat" -arch=x64',
      "if errorlevel 1 exit /b %errorlevel%",
      "cl.exe /nologo main.cpp",
      "exit /b %errorlevel%",
      "",
    ].join("\r\n"));
  });
});
