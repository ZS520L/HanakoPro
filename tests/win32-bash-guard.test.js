import { describe, expect, it } from "vitest";
import { assertSafeWin32BashCommand } from "../lib/sandbox/win32-bash-guard.js";

describe("assertSafeWin32BashCommand", () => {
  it("rejects CMD nul redirection targets in bash syntax", () => {
    expect(() => assertSafeWin32BashCommand("ipconfig /all > nul 2>&1")).toThrow("/dev/null");
    expect(() => assertSafeWin32BashCommand("tool 2> NUL.txt")).toThrow("/dev/null");
  });

  it("allows bash null-device redirection and quoted CMD syntax", () => {
    expect(() => assertSafeWin32BashCommand("ipconfig /all > /dev/null 2>&1")).not.toThrow();
    expect(() => assertSafeWin32BashCommand('cmd.exe /c "dir > nul"')).not.toThrow();
  });
});
