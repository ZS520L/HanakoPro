import { describe, expect, it } from "vitest";
import { classifyWin32Command } from "../lib/sandbox/win32-command-router.js";

describe("classifyWin32Command", () => {
  const resolveNativePath = (name) => {
    const table = {
      ipconfig: "C:\\Windows\\System32\\ipconfig.exe",
      reg: "C:\\Windows\\System32\\reg.exe",
      git: "C:\\Program Files\\Git\\cmd\\git.exe",
      python: "C:\\Users\\Me\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    };
    return table[name.toLowerCase()] || null;
  };

  it("routes Windows system executables to cmd", () => {
    expect(classifyWin32Command("ipconfig /all", { resolveNativePath }).runner).toBe("cmd");
    expect(classifyWin32Command("reg query HKCU\\Software", { resolveNativePath }).runner).toBe("cmd");
  });

  it("routes cmd builtins to cmd", () => {
    expect(classifyWin32Command("dir C:\\", { resolveNativePath }).runner).toBe("cmd");
  });

  it("routes explicit Windows shells to cmd", () => {
    expect(classifyWin32Command("cmd /c dir", { resolveNativePath }).runner).toBe("cmd");
    expect(classifyWin32Command('powershell -Command "ipconfig /all"', { resolveNativePath }).runner).toBe("cmd");
  });

  it("keeps explicit POSIX shells on the bash path", () => {
    expect(classifyWin32Command("bash -lc pwd", { resolveNativePath }).runner).toBe("bash");
    expect(classifyWin32Command("sh -lc pwd", { resolveNativePath }).runner).toBe("bash");
  });

  it("routes simple Git commands to the structured git runner", () => {
    expect(classifyWin32Command("git status", { resolveNativePath }).runner).toBe("git");
  });

  it("routes simple Python commands to the structured python runner", () => {
    expect(classifyWin32Command("python script.py", { resolveNativePath }).runner).toBe("python");
    expect(classifyWin32Command('python -c "import sys; print(sys.version)"', { resolveNativePath }).runner).toBe("python");
  });

  it("routes simple Node commands to the structured node runner", () => {
    expect(classifyWin32Command("node server.js", { resolveNativePath }).runner).toBe("node");
    expect(classifyWin32Command('node -e "console.log(process.version)"', { resolveNativePath }).runner).toBe("node");
  });

  it("keeps shell-shaped Python commands on the bash path", () => {
    expect(classifyWin32Command("python script.py > out.txt", { resolveNativePath }).runner).toBe("bash");
  });

  it("keeps shell-shaped Node commands on the bash path", () => {
    expect(classifyWin32Command("node server.js > out.txt", { resolveNativePath }).runner).toBe("bash");
  });

  it("keeps complex POSIX commands on the bash path", () => {
    expect(classifyWin32Command("ls && pwd", { resolveNativePath }).runner).toBe("bash");
  });
});
