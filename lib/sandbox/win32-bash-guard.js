function readShellWord(command, start) {
  let word = "";
  let quote = null;
  for (let i = start; i < command.length; i++) {
    const ch = command[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }

    if (quote === "\"") {
      if (ch === "\"") {
        quote = null;
      } else if (ch === "\\" && i + 1 < command.length && /["\\$`\n]/.test(command[i + 1])) {
        word += command[++i];
      } else {
        word += ch;
      }
      continue;
    }

    if (/\s|[;&|<>]/.test(ch)) break;
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      word += command[++i];
      continue;
    }
    word += ch;
  }
  return word;
}

function isWindowsNulDeviceTarget(target) {
  const cleaned = String(target || "").trim();
  if (!cleaned) return false;
  const basename = (cleaned.split(/[\\/]/).pop() || cleaned).replace(/[ .]+$/g, "");
  const deviceName = basename.split(".")[0].toLowerCase();
  return deviceName === "nul";
}

function findCmdNulRedirectionTarget(command) {
  let quote = null;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
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
    if (ch !== ">") continue;

    let targetStart = i + 1;
    if (command[targetStart] === ">" || command[targetStart] === "|") targetStart++;
    while (/\s/.test(command[targetStart] || "")) targetStart++;

    if (command[targetStart] === "&") {
      targetStart++;
      while (/\s/.test(command[targetStart] || "")) targetStart++;
      const fdTarget = readShellWord(command, targetStart);
      if (/^\d+$|^-?$/.test(fdTarget)) continue;
      if (isWindowsNulDeviceTarget(fdTarget)) return fdTarget;
      continue;
    }

    const target = readShellWord(command, targetStart);
    if (isWindowsNulDeviceTarget(target)) return target;
  }

  return null;
}

export function assertSafeWin32BashCommand(command) {
  const target = findCmdNulRedirectionTarget(String(command || ""));
  if (!target) return;
  throw new Error(
    `[win32-exec] Refusing to run CMD null-device redirection in bash: "${target}". ` +
    "This command is executed by bash on Windows; use /dev/null to discard output, or run an explicitly quoted cmd.exe /c command for CMD syntax."
  );
}
