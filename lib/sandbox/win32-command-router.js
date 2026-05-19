import { spawnSync } from "child_process";

const EXPLICIT_WINDOWS_SHELLS = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);

const EXPLICIT_POSIX_SHELLS = new Set([
  "bash",
  "bash.exe",
  "sh",
  "sh.exe",
]);

const CMD_BUILTINS = new Set([
  "assoc",
  "break",
  "call",
  "cd",
  "chdir",
  "cls",
  "copy",
  "date",
  "del",
  "dir",
  "echo",
  "endlocal",
  "erase",
  "exit",
  "for",
  "ftype",
  "goto",
  "if",
  "md",
  "mklink",
  "move",
  "path",
  "pause",
  "popd",
  "prompt",
  "pushd",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "set",
  "setlocal",
  "shift",
  "start",
  "time",
  "title",
  "type",
  "ver",
  "verify",
  "vol",
]);

const PYTHON_COMMANDS = new Set([
  "python",
  "python.exe",
  "python3",
  "python3.exe",
]);

const NODE_COMMANDS = new Set([
  "node",
  "node.exe",
]);

const SYSTEM_PATH_PATTERN = /\\windows\\(system32|sysnative|syswow64)\\/i;
const nativePathCache = new Map();

function getFirstToken(command) {
  const trimmed = String(command || "").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^"([^"]+)"|^'([^']+)'|^([^\s]+)/);
  return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function getTokenBaseName(token) {
  return token.split(/[\\/]/).pop()?.toLowerCase() || "";
}

function hasComplexShellSyntax(command) {
  const input = String(command || "");
  let quote = null;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === "\\" && quote !== "'") {
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (ch === "`" || ch === ";" || ch === "|" || ch === "<" || ch === ">") return true;
    if (ch === "&" && input[i + 1] === "&") return true;
    if (ch === "$" && input[i + 1] === "(") return true;
  }

  return false;
}

function defaultResolveNativePath(name) {
  const key = String(name || "").toLowerCase();
  if (!key) return null;
  if (nativePathCache.has(key)) return nativePathCache.get(key);

  try {
    const result = spawnSync("where.exe", [key], {
      encoding: "utf-8",
      windowsHide: true,
      timeout: 3000,
    });
    const resolved = result.status === 0
      ? (result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || null
      : null;
    nativePathCache.set(key, resolved);
    return resolved;
  } catch {
    nativePathCache.set(key, null);
    return null;
  }
}

export function classifyWin32Command(command, { resolveNativePath = defaultResolveNativePath } = {}) {
  const token = getFirstToken(command);
  const lower = token.toLowerCase();
  const baseName = getTokenBaseName(token);

  if (!token) return { runner: "bash", reason: "empty" };
  if (EXPLICIT_WINDOWS_SHELLS.has(lower)) return { runner: "cmd", reason: "explicit-windows-shell" };
  if (EXPLICIT_POSIX_SHELLS.has(lower)) return { runner: "bash", reason: "explicit-posix-shell" };
  if (hasComplexShellSyntax(command)) return { runner: "bash", reason: "complex-shell" };
  if (baseName === "git" || baseName === "git.exe") {
    return { runner: "git", reason: "git-command" };
  }
  if (PYTHON_COMMANDS.has(baseName)) return { runner: "python", reason: "python-command" };
  if (NODE_COMMANDS.has(baseName)) return { runner: "node", reason: "node-command" };
  if (CMD_BUILTINS.has(lower)) return { runner: "cmd", reason: "cmd-builtin" };

  const resolved = resolveNativePath(lower);
  if (resolved && SYSTEM_PATH_PATTERN.test(resolved)) {
    return { runner: "cmd", reason: "windows-system-executable", path: resolved };
  }

  return { runner: "bash", reason: "default-bash" };
}
