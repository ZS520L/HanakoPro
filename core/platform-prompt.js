import os from "node:os";

// 模型侧看到稳定的 bash 工具契约；Windows 的 Git/cmd/POSIX runtime
// 分派属于 win32-exec 的执行层细节，避免泄漏到 prompt 里干扰规划。
function getExecShellLabel() {
  return "bash";
}

export function getPlatformPromptNote({
  platform = process.platform,
  osType = os.type(),
  osRelease = os.release(),
} = {}) {
  const lines = [
    `Platform: ${platform}`,
    `Shell: ${getExecShellLabel(platform)}`,
    `OS Version: ${osType} ${osRelease}`,
  ];
  if (platform === "win32") {
    lines.push(
      "Host OS is Windows, but the bash tool accepts POSIX shell-style commands.",
      "Hanako may internally route simple git commands through bundled git.exe and explicit cmd.exe/powershell.exe commands through Windows-native runners.",
      "Prefer POSIX syntax for pipes, paths, environment variables, and redirection when writing shell-style commands.",
      "Use cmd.exe /c or powershell.exe -NoProfile -Command only when you explicitly need a Windows-native shell.",
      "Discard POSIX command output with /dev/null; use CMD's nul device only inside an explicit cmd.exe command.",
    );
  }
  // 共享终端工具引导：让模型知道何时优先用 terminal_* 而不是 bash
  lines.push(
    "",
    "Shell tool selection guidance:",
    "- Default to the `terminal_*` tools (terminal_list / terminal_create / terminal_read / terminal_write / terminal_interrupt / terminal_kill) for ANY command that the user might want to watch, that may take more than a few seconds, that is long-running / interactive / a dev server / a watcher / a ping / a build, or that you might need to interrupt mid-flight. The terminal_* tools share the same PTY pool as the user's visible Terminal window — the user can see exactly what is running and you can send Ctrl+C via terminal_interrupt at any time.",
    "- Use `bash` only for short, deterministic, fire-and-forget commands whose output you need fully captured (file inspection, quick computations, one-shot scripts). `bash` blocks until exit and CANNOT be interrupted; if a `bash` invocation hangs, the user has no way to recover gracefully.",
    "- When the user explicitly asks you to \"run something in the terminal\", to \"start\" a process, or implies a watchable / cancellable command, ALWAYS choose terminal_* over bash.",
    "- Typical terminal_* flow: optionally terminal_list → reuse an existing session OR terminal_create → terminal_write with the command (auto-appends Enter) → terminal_wait to block until output settles / process exits / user kills it (returns within ms when the user does anything) → terminal_read to see output → optionally terminal_interrupt to stop it.",
    "- ALWAYS prefer `terminal_wait` over the generic `wait` tool after a terminal_write. terminal_wait is event-driven and returns immediately when: new output arrives, the process exits, or the user manually closes/kills the terminal. The generic `wait` tool only sleeps for a fixed time and would leave you unaware of user-side actions until your sleep finishes — that is a bad UX.",
    "- DO NOT call terminal_create more than once per logical task. After you've created a session for a task (e.g. 'open a tab and run X then interrupt it'), reuse that same session id for ALL subsequent operations on it (write / wait / interrupt / read / kill). Every extra terminal_create produces a new shell tab the user has to manage, and it splits the per-turn output cards in the chat. Only create a NEW session when you genuinely need a parallel shell or a different cwd.",
    "- After a terminal_write that submits a command, prefer running ONE terminal_wait that covers the whole expected duration (large timeout_ms or idle_ms) over chaining many short waits. Each separate wait only captures bytes inside its own window, so chaining them fragments the chat-side preview card; a single wait gives the user one clean card containing the full command output.",
    "- 当用户在对话内嵌的终端卡片上按了「打断」按钮时，你会通过 terminal_wait 的 reason=human_interrupt 或 details.humanInterruptsInWindow / details.humanInterrupts 非空 感知到。此时**只**做两件事：用一句自然的话向用户致歉并询问下一步想怎么做；停止你当前的整套计划。绝对不要重跑刚才被打断的命令，也不要把上述字段名（reason、human_interrupt、terminal_wait 等内部机制）讲给用户听，那些是你内部的实现细节，用户不需要知道。",
  );
  return lines.join("\n");
}
