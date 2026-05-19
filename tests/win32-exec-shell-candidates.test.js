import { describe, expect, it } from "vitest";
import path from "path";
import { __testing } from "../lib/sandbox/win32-exec.js";

describe("win32 bundled shell candidates", () => {
  it("discovers PortableGit Bash before legacy MinGit fallbacks", () => {
    const gitRoot = "C:\\Program Files\\Hanako\\resources\\git";
    const existing = new Set([
      path.win32.join(gitRoot, "bin", "bash.exe"),
      path.win32.join(gitRoot, "usr", "bin", "bash.exe"),
      path.win32.join(gitRoot, "mingw64", "bin", "ash.exe"),
      path.win32.join(gitRoot, "mingw64", "bin", "busybox.exe"),
    ]);

    const candidates = __testing.getBundledShellCandidates(
      { HANA_ROOT: "C:\\Program Files\\Hanako\\resources\\server" },
      {
        resourcesPath: "C:\\Program Files\\Hanako\\resources",
        resourceSiblingDir: () => null,
        exists: (filePath) => existing.has(filePath),
      },
    );

    expect(candidates.map((candidate) => path.win32.relative(gitRoot, candidate.shell))).toEqual([
      path.win32.join("bin", "bash.exe"),
      path.win32.join("usr", "bin", "bash.exe"),
      path.win32.join("mingw64", "bin", "ash.exe"),
      path.win32.join("mingw64", "bin", "busybox.exe"),
    ]);
    expect(candidates[0].args).toEqual(["-lc"]);
    expect(candidates.find((candidate) => path.win32.basename(candidate.shell) === "ash.exe")?.args).toEqual(["-c"]);
    expect(candidates.find((candidate) => path.win32.basename(candidate.shell) === "busybox.exe")?.args).toEqual(["sh", "-c"]);
  });

  it("prepends bundled PortableGit runtime directories to the shell PATH", () => {
    const gitRoot = "C:\\Program Files\\Hanako\\resources\\git";
    const shell = path.win32.join(gitRoot, "bin", "bash.exe");
    const env = __testing.getShellEnvForCandidate(
      { Path: "C:\\Windows\\System32" },
      { shell, args: ["-lc"], bundledRoot: gitRoot },
    );

    const segments = env.Path.split(";");
    expect(segments.slice(0, 4)).toEqual([
      path.win32.join(gitRoot, "bin"),
      path.win32.join(gitRoot, "usr", "bin"),
      path.win32.join(gitRoot, "mingw64", "bin"),
      path.win32.join(gitRoot, "cmd"),
    ]);
    expect(segments).toContain("C:\\Windows\\System32");
  });
});
