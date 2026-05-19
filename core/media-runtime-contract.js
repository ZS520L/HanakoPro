const VALID_RUNTIME_KINDS = new Set(["http", "oauth-http", "local-cli", "browser-cli", "plugin"]);
const VALID_OUTPUT_KINDS = new Set(["file_glob", "json_stdout", "url_stdout"]);
const VALID_BINDING_SOURCES = new Set([
  "prompt",
  "modelId",
  "inputFile",
  "outputDir",
  "size",
  "duration",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRuntimeKind(kind) {
  const value = String(kind || "").trim();
  if (!VALID_RUNTIME_KINDS.has(value)) {
    throw new Error(`Unsupported media runtime kind "${kind}"`);
  }
  return value;
}

export function validateCliCommandSpec(spec) {
  if (!isPlainObject(spec)) {
    throw new Error("Expected structured CLI command spec");
  }
  if (typeof spec.executable !== "string" || !spec.executable.trim()) {
    throw new Error("CLI command spec requires executable");
  }
  if (!Array.isArray(spec.args)) {
    throw new Error("CLI command spec requires structured args");
  }
  for (const arg of spec.args) {
    if (!isPlainObject(arg)) {
      throw new Error("CLI args must be structured bindings");
    }
    const hasLiteral = Object.prototype.hasOwnProperty.call(arg, "literal");
    const hasOption = Object.prototype.hasOwnProperty.call(arg, "option");
    if (hasLiteral === hasOption) {
      throw new Error("CLI arg binding must contain exactly one of literal or option");
    }
    if (hasLiteral && typeof arg.literal !== "string") {
      throw new Error("CLI literal arg must be a string");
    }
    if (hasOption) {
      if (typeof arg.option !== "string" || !arg.option.trim()) {
        throw new Error("CLI option binding requires option");
      }
      if (!VALID_BINDING_SOURCES.has(arg.from)) {
        throw new Error(`Unsupported CLI binding source "${arg.from}"`);
      }
    }
  }
  if (!isPlainObject(spec.output) || !VALID_OUTPUT_KINDS.has(spec.output.kind)) {
    throw new Error("CLI command spec requires a supported output contract");
  }
  const timeoutMs = Number(spec.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("CLI command spec requires positive timeoutMs");
  }
  return spec;
}

export function validateProviderRuntime(runtime) {
  if (!runtime) return null;
  if (!isPlainObject(runtime)) {
    throw new Error("Provider runtime must be an object");
  }
  const kind = normalizeRuntimeKind(runtime.kind);
  if (kind === "local-cli" || kind === "browser-cli") {
    validateCliCommandSpec(runtime.command);
  }
  return runtime;
}

export function buildCliArgs(spec, bindings = {}) {
  validateCliCommandSpec(spec);
  const args = [];
  for (const arg of spec.args) {
    if (Object.prototype.hasOwnProperty.call(arg, "literal")) {
      args.push(arg.literal);
      continue;
    }
    const value = bindings[arg.from];
    if (value === undefined || value === null || value === "") continue;
    args.push(arg.option, String(value));
  }
  return args;
}
