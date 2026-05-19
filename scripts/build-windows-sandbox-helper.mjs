#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function shouldBuildWindowsSandboxHelper({ platform = process.platform } = {}) {
  return platform === "win32";
}

export function windowsSandboxHelperOutputDir({
  rootDir = path.resolve(__dirname, ".."),
  arch = process.arch,
} = {}) {
  return path.join(rootDir, "dist-sandbox", `win-${arch}`);
}

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

export function buildWindowsSandboxCompileCommand({ source, output } = {}) {
  if (!source) throw new Error("source is required");
  if (!output) throw new Error("output is required");
  return [
    "cl.exe",
    "/nologo",
    "/EHsc",
    "/std:c++17",
    "/W4",
    "/O2",
    quoteCmd(source),
    "/link",
    `/OUT:${quoteCmd(output)}`,
    "userenv.lib",
    "advapi32.lib",
  ].join(" ");
}

export function buildWindowsSandboxBatchScript({ devCmd, compileCommand, arch } = {}) {
  if (!compileCommand) throw new Error("compileCommand is required");
  const msvcArch = arch === "arm64" ? "arm64" : "x64";
  const lines = ["@echo off"];
  if (devCmd) {
    lines.push(`call ${quoteCmd(devCmd)} -arch=${msvcArch}`);
    lines.push("if errorlevel 1 exit /b %errorlevel%");
  }
  lines.push(compileCommand);
  lines.push("exit /b %errorlevel%");
  return `${lines.join("\r\n")}\r\n`;
}

function findVsDevCmd() {
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!fs.existsSync(vswhere)) return null;
  try {
    const installationPath = execFileSync(vswhere, [
      "-latest",
      "-products", "*",
      "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property", "installationPath",
    ], { encoding: "utf8", windowsHide: true }).trim();
    if (!installationPath) return null;
    const devCmd = path.join(installationPath, "Common7", "Tools", "VsDevCmd.bat");
    return fs.existsSync(devCmd) ? devCmd : null;
  } catch {
    return null;
  }
}

function runCompile(command, { rootDir, arch }) {
  const devCmd = findVsDevCmd();
  const scriptPath = path.join(windowsSandboxHelperOutputDir({ rootDir, arch }), "build-windows-sandbox-helper.cmd");
  fs.writeFileSync(scriptPath, buildWindowsSandboxBatchScript({ devCmd, compileCommand: command, arch }), "utf-8");
  execFileSync("cmd.exe", ["/d", "/c", scriptPath], {
    cwd: rootDir,
    stdio: "inherit",
    windowsHide: true,
  });
}

export function buildWindowsSandboxHelper({
  rootDir = path.resolve(__dirname, ".."),
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (!shouldBuildWindowsSandboxHelper({ platform })) {
    console.log(`[windows-sandbox-helper] skipped on ${platform}`);
    return { skipped: true };
  }

  const source = path.join(rootDir, "desktop", "native", "HanaWindowsSandboxHelper", "main.cpp");
  if (!fs.existsSync(source)) {
    throw new Error(`[windows-sandbox-helper] source not found: ${source}`);
  }

  const outDir = windowsSandboxHelperOutputDir({ rootDir, arch });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, "hana-win-sandbox.exe");
  const command = buildWindowsSandboxCompileCommand({ source, output });
  console.log(`[windows-sandbox-helper] building ${output}`);
  runCompile(command, { rootDir, arch });
  if (!fs.existsSync(output)) {
    throw new Error(`[windows-sandbox-helper] build did not produce ${output}`);
  }
  return { skipped: false, target: output };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    buildWindowsSandboxHelper({ arch: process.argv[2] || process.arch });
  } catch (err) {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  }
}
