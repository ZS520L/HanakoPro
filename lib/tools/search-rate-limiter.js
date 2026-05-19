const DEFAULT_RETRY_JITTER_MS = 1_000;

const DEFAULT_POLICIES = Object.freeze({
  bing_browser: Object.freeze({
    minIntervalMs: 3_000,
    jitterMs: 4_000,
    rateLimitBaseDelayMs: 10_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
  duckduckgo_browser: Object.freeze({
    minIntervalMs: 3_000,
    jitterMs: 4_000,
    rateLimitBaseDelayMs: 10_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
  google_browser: Object.freeze({
    minIntervalMs: 6_000,
    jitterMs: 8_000,
    rateLimitBaseDelayMs: 30_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 10 * 60_000,
  }),
  brave: Object.freeze({
    minIntervalMs: 1_100,
    jitterMs: 400,
    rateLimitBaseDelayMs: 2_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
  tavily: Object.freeze({
    minIntervalMs: 650,
    jitterMs: 350,
    rateLimitBaseDelayMs: 2_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
  serper: Object.freeze({
    minIntervalMs: 1_000,
    jitterMs: 500,
    rateLimitBaseDelayMs: 2_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
});

const FALLBACK_POLICIES = Object.freeze({
  browser: Object.freeze({
    minIntervalMs: 3_000,
    jitterMs: 4_000,
    rateLimitBaseDelayMs: 10_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
  api: Object.freeze({
    minIntervalMs: 1_000,
    jitterMs: 500,
    rateLimitBaseDelayMs: 2_000,
    retryJitterMs: DEFAULT_RETRY_JITTER_MS,
    maxCooldownMs: 5 * 60_000,
  }),
});

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function retryAfterMsFromHeaders(headers) {
  if (!headers) return null;
  const raw = headers.get?.("retry-after") || headers.get?.("Retry-After");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1_000);
  }

  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

export class SearchRateLimitError extends Error {
  constructor(message, { retryAfterMs = null, status = 429 } = {}) {
    super(message);
    this.name = "SearchRateLimitError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.isSearchRateLimitError = true;
  }
}

export class SearchRateLimiter {
  constructor({ policies = {}, random = Math.random } = {}) {
    this._policies = { ...DEFAULT_POLICIES, ...policies };
    this._random = random;
    this._states = new Map();
  }

  reset() {
    this._states.clear();
  }

  async run(provider, sourceType, operation) {
    const key = String(provider || sourceType || "search");
    const state = this._stateFor(key);
    const previous = state.queue.catch(() => {});

    const current = previous.then(async () => {
      await this._waitForTurn(key, sourceType);
      try {
        const result = await operation();
        state.rateLimitFailures = 0;
        return result;
      } catch (err) {
        this._recordRateLimit(key, sourceType, err);
        throw err;
      }
    });

    state.queue = current.catch(() => {});
    return current;
  }

  _stateFor(key) {
    let state = this._states.get(key);
    if (!state) {
      state = {
        queue: Promise.resolve(),
        lastStartAt: null,
        cooldownUntil: 0,
        rateLimitFailures: 0,
      };
      this._states.set(key, state);
    }
    return state;
  }

  _policy(provider, sourceType) {
    return this._policies[provider]
      || FALLBACK_POLICIES[sourceType]
      || FALLBACK_POLICIES.api;
  }

  _jitter(maxMs) {
    const max = positiveInteger(maxMs);
    if (max <= 0) return 0;
    return Math.floor(this._random() * max);
  }

  async _waitForTurn(provider, sourceType) {
    const state = this._stateFor(provider);
    const policy = this._policy(provider, sourceType);
    const now = Date.now();

    const intervalUntil = state.lastStartAt == null
      ? now
      : state.lastStartAt + positiveInteger(policy.minIntervalMs) + this._jitter(policy.jitterMs);
    const waitUntil = Math.max(intervalUntil, state.cooldownUntil || 0);

    if (waitUntil > now) {
      await sleep(waitUntil - now);
    }

    state.lastStartAt = Date.now();
    if (state.cooldownUntil && state.cooldownUntil <= state.lastStartAt) {
      state.cooldownUntil = 0;
    }
  }

  _recordRateLimit(provider, sourceType, err) {
    if (!err?.isSearchRateLimitError && err?.status !== 429) return;

    const state = this._stateFor(provider);
    const policy = this._policy(provider, sourceType);
    const retryAfter = err?.retryAfterMs == null ? null : Number(err.retryAfterMs);
    const hasRetryAfter = Number.isFinite(retryAfter) && retryAfter >= 0;
    const baseCooldownMs = hasRetryAfter
      ? Math.floor(retryAfter)
      : positiveInteger(policy.rateLimitBaseDelayMs) * (2 ** Math.min(state.rateLimitFailures, 8));
    const cooldownMs = Math.min(
      positiveInteger(policy.maxCooldownMs),
      baseCooldownMs + this._jitter(policy.retryJitterMs),
    );
    state.rateLimitFailures += 1;
    state.cooldownUntil = Math.max(state.cooldownUntil || 0, Date.now() + cooldownMs);
  }
}

export function createSearchRateLimiter(opts = {}) {
  return new SearchRateLimiter(opts);
}
