/**
 * Shared diagnostic log redaction.
 *
 * Pure JavaScript by design: this module is imported by server code, Electron
 * main-process code, and renderer-shared ErrorBus code after bundling.
 */

const REDACTED = "[redacted]";

const SECRET_KEY_PATTERN = "api[_-]?key|apikey|api-key|secret[_-]?key|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|bot[_-]?token|server[_-]?token";
const SECRET_ASSIGN_RE = new RegExp(`\\b(${SECRET_KEY_PATTERN})\\b\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,"'\\]}]+)`, "gi");
const SENSITIVE_OBJECT_KEY_RE = /^(api[_-]?key|apikey|api-key|authorization|cookie|set-cookie|secret[_-]?key|secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|client[_-]?secret|bot[_-]?token|server[_-]?token|private[_-]?key|credential|credentials|session[_-]?key|session[_-]?id|user[_-]?id|chat[_-]?id|sender[_-]?name|avatar[_-]?url|owner|download[_-]?param|filekey)$/i;
const URL_SECRET_QUERY_RE = /([?&](?:token|access_token|refresh_token|auth|authorization|api_key|apikey|api-key|key|secret|password|client_secret|code)=)([^&#\s]+)/gi;
const API_KEY_VALUE_RE = /\b(sk-[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gsk_[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,}|xox[abpors]-[a-zA-Z0-9-]+)\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const CREDIT_CARD_RE = /\b(?:\d{4}[- ]?){3}\d{4}\b/g;
const CN_ID_CARD_RE = /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const LONG_RANDOM_RE = /(^|[^\w/.-])([A-Za-z0-9+/_=-]{40,})(?=$|[^\w/.-])/g;

function redactLogText(value, options = {}) {
  if (value == null) return "";
  let text = String(value);

  text = redactKnownPaths(text, options);

  text = text.replace(/data:([^;,]+);base64,[A-Za-z0-9+/=]+/gi, "data:$1;base64,[redacted]");
  text = text.replace(/(https?:\/\/)([^:@\s/?#]+):([^@\s/?#]+)@/gi, "$1[credentials]@");
  text = text.replace(URL_SECRET_QUERY_RE, "$1[redacted]");
  text = text.replace(/\b(Authorization\s*[:=]\s*Bearer\s+)[^\s,;]+/gi, "$1[redacted]");
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "$1[redacted]");
  text = text.replace(/\b(Cookie|Set-Cookie)\s*[:=]\s*[^\r\n]+/gi, "$1=[redacted]");
  text = text.replace(SECRET_ASSIGN_RE, (_m, key) => `${key}=[redacted]`);
  text = text.replace(API_KEY_VALUE_RE, REDACTED);
  text = text.replace(CREDIT_CARD_RE, "[credit_card]");
  text = text.replace(CN_ID_CARD_RE, "[id_card]");
  text = text.replace(SSN_RE, "[ssn]");
  text = text.replace(EMAIL_RE, "[email]");
  text = text.replace(LONG_RANDOM_RE, "$1[token]");

  return text;
}

function redactKnownPaths(text, options) {
  let out = text;
  const paths = [];
  if (options.homeDir) paths.push([options.homeDir, "~"]);
  if (Array.isArray(options.extraPaths)) {
    for (const p of options.extraPaths) paths.push([p, "[path]"]);
  }

  for (const [rawPath, replacement] of paths) {
    if (!rawPath || typeof rawPath !== "string") continue;
    const variants = pathVariants(rawPath);
    for (const variant of variants) {
      out = out.split(variant).join(replacement);
      if (variant.startsWith("/")) {
        out = out.split(`file://${variant}`).join(`file://${replacement}`);
      }
    }
  }

  out = out.replace(/file:\/\/\/Users\/[^/\s]+/g, "file:///Users/[user]");
  out = out.replace(/\/Users\/[^/\s]+/g, "/Users/[user]");
  out = out.replace(/file:\/\/\/home\/[^/\s]+/g, "file:///home/[user]");
  out = out.replace(/\/home\/[^/\s]+/g, "/home/[user]");
  out = out.replace(/\b([A-Za-z]:\\Users\\)[^\\/\s]+/g, "$1[user]");
  out = out.replace(/\b([A-Za-z]:\/Users\/)[^\\/\s]+/g, "$1[user]");

  return out;
}

function pathVariants(rawPath) {
  const variants = new Set([rawPath]);
  if (rawPath.includes("\\")) variants.add(rawPath.replace(/\\/g, "/"));
  if (rawPath.includes("/")) variants.add(rawPath.replace(/\//g, "\\"));
  return variants;
}

function redactLogValue(value, options = {}, state = {}) {
  const depth = state.depth || 0;
  const seen = state.seen || new WeakSet();

  if (value == null) return value;
  if (typeof value === "string") return redactLogText(value, options);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "symbol" || typeof value === "function") return redactLogText(String(value), options);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogText(value.message, options),
      stack: value.stack ? redactLogText(value.stack, options) : undefined,
      code: value.code ? redactLogText(String(value.code), options) : undefined,
    };
  }

  if (typeof value !== "object") return redactLogText(String(value), options);
  if (seen.has(value)) return "[Circular]";
  if (depth >= 8) return "[MaxDepth]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, options, { depth: depth + 1, seen }));
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = redactLogLabel(key);
    if (SENSITIVE_OBJECT_KEY_RE.test(key)) {
      out[cleanKey] = REDACTED;
    } else {
      out[cleanKey] = redactLogValue(item, options, { depth: depth + 1, seen });
    }
  }
  return out;
}

function redactLogLabel(value) {
  return redactLogText(value == null ? "unknown" : String(value))
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 80) || "unknown";
}

function formatLogArgs(args, options = {}) {
  return Array.from(args || []).map((arg) => {
    if (typeof arg === "string") return redactLogText(arg, options);
    const cleaned = redactLogValue(arg, options);
    try {
      return JSON.stringify(cleaned);
    } catch {
      return redactLogText(String(cleaned), options);
    }
  }).join(" ");
}

const api = {
  redactLogText,
  redactLogValue,
  redactLogLabel,
  formatLogArgs,
};

module.exports = api;
module.exports.default = api;
