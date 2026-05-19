import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCliArgs, validateCliCommandSpec } from "../../../core/media-runtime-contract.js";

const execFileAsync = promisify(execFile);

function globToMatcher(pattern) {
  if (pattern === "*") return () => true;
  const brace = pattern.match(/^\*\.{(.+)}$/);
  if (brace) {
    const exts = new Set(brace[1].split(",").map((ext) => ext.trim().toLowerCase()).filter(Boolean));
    return (filename) => exts.has(path.extname(filename).slice(1).toLowerCase());
  }
  if (pattern.startsWith("*.")) {
    const ext = pattern.slice(2).toLowerCase();
    return (filename) => path.extname(filename).slice(1).toLowerCase() === ext;
  }
  return (filename) => filename === pattern;
}

function collectFileGlob(outputDir, pattern) {
  const matcher = globToMatcher(pattern || "*");
  return fs.readdirSync(outputDir)
    .filter((name) => matcher(name))
    .map((name) => path.join(outputDir, name))
    .sort();
}

function parseJsonPath(value, pathExpr) {
  const parts = String(pathExpr || "").split(".").filter(Boolean);
  let cur = value;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export async function runLocalCliMedia(spec, bindings = {}, options = {}) {
  validateCliCommandSpec(spec);
  const outputDir = bindings.outputDir || options.outputDir;
  if (!outputDir) throw new Error("CLI media wrapper requires outputDir");
  fs.mkdirSync(outputDir, { recursive: true });

  const args = buildCliArgs(spec, { ...bindings, outputDir });
  const execOptions = {
    cwd: options.cwd || outputDir,
    timeout: spec.timeoutMs,
    shell: false,
    env: { ...process.env, ...(spec.env || {}), ...(options.env || {}) },
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  };
  const { stdout, stderr } = await execFileAsync(spec.executable, args, execOptions);

  if (spec.output.kind === "file_glob") {
    return {
      files: collectFileGlob(outputDir, spec.output.pattern),
      stdout,
      stderr,
    };
  }

  if (spec.output.kind === "json_stdout") {
    const parsed = JSON.parse(stdout || "{}");
    const files = parseJsonPath(parsed, spec.output.filesPath);
    return {
      files: Array.isArray(files) ? files : [],
      data: parsed,
      stdout,
      stderr,
    };
  }

  if (spec.output.kind === "url_stdout") {
    const url = String(stdout || "").trim();
    return {
      urls: url ? [url] : [],
      stdout,
      stderr,
    };
  }

  throw new Error(`Unsupported CLI output kind "${spec.output.kind}"`);
}
