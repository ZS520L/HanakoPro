import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SearchRateLimitError,
  createSearchRateLimiter,
  retryAfterMsFromHeaders,
} from "../lib/tools/search-rate-limiter.js";

describe("SearchRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes repeated calls for the same provider and applies jittered spacing", async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createSearchRateLimiter({ random: () => 0.5 });
    const starts = [];

    const first = limiter.run("bing_browser", "browser", async () => {
      starts.push(Date.now());
      return "first";
    });
    await vi.advanceTimersByTimeAsync(0);

    const second = limiter.run("bing_browser", "browser", async () => {
      starts.push(Date.now());
      return "second";
    });

    await expect(first).resolves.toBe("first");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(starts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe("second");
    expect(starts).toEqual([0, 5_000]);
  });

  it("does not let one provider block a different provider", async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createSearchRateLimiter({ random: () => 0.5 });
    const starts = [];

    const bing = limiter.run("bing_browser", "browser", async () => {
      starts.push(["bing_browser", Date.now()]);
      return "bing";
    });
    const brave = limiter.run("brave", "api", async () => {
      starts.push(["brave", Date.now()]);
      return "brave";
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(Promise.all([bing, brave])).resolves.toEqual(["bing", "brave"]);
    expect(starts).toEqual([
      ["bing_browser", 0],
      ["brave", 0],
    ]);
  });

  it("holds subsequent calls after a rate limit error until Retry-After plus jitter", async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createSearchRateLimiter({ random: () => 0.5 });
    const starts = [];
    const rateLimit = new SearchRateLimitError("Brave API 429", { retryAfterMs: 2_000 });

    await expect(
      limiter.run("brave", "api", async () => {
        throw rateLimit;
      }),
    ).rejects.toThrow("Brave API 429");

    const next = limiter.run("brave", "api", async () => {
      starts.push(Date.now());
      return "ok";
    });

    await vi.advanceTimersByTimeAsync(2_499);
    expect(starts).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe("ok");
    expect(starts).toEqual([2_500]);
  });

  it("uses exponential cooldown when a rate limit error has no Retry-After", async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = createSearchRateLimiter({ random: () => 0.5 });
    const starts = [];

    await expect(
      limiter.run("brave", "api", async () => {
        throw new SearchRateLimitError("Brave API 429");
      }),
    ).rejects.toThrow("Brave API 429");

    const secondFailure = limiter.run("brave", "api", async () => {
      starts.push(["second", Date.now()]);
      throw new SearchRateLimitError("Brave API 429 again");
    });
    const secondFailureCheck = expect(secondFailure).rejects.toThrow("Brave API 429 again");
    await vi.advanceTimersByTimeAsync(2_499);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await secondFailureCheck;
    expect(starts).toEqual([["second", 2_500]]);

    const recovery = limiter.run("brave", "api", async () => {
      starts.push(["recovery", Date.now()]);
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(4_499);
    expect(starts).toEqual([["second", 2_500]]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(recovery).resolves.toBe("ok");
    expect(starts).toEqual([
      ["second", 2_500],
      ["recovery", 7_000],
    ]);
  });

  it("parses Retry-After as seconds or an HTTP date", () => {
    expect(retryAfterMsFromHeaders(new Headers({ "retry-after": "3" }))).toBe(3_000);

    vi.useFakeTimers({ now: new Date("2026-05-03T10:00:00.000Z") });
    expect(
      retryAfterMsFromHeaders(
        new Headers({ "retry-after": "Sun, 03 May 2026 10:00:05 GMT" }),
      ),
    ).toBe(5_000);
  });
});
