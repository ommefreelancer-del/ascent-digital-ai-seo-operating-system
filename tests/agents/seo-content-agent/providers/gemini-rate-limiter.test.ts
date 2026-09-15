import { describe, expect, it, vi } from "vitest";
import { GeminiDailyQuotaExhaustedError, GeminiRateLimiter } from "../../../../src/agents/seo-content-agent/providers/gemini-rate-limiter.js";

const DAILY_QUOTA_ERROR_TEXT =
  '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier ... quotaValue: 20"}}';

describe("GeminiRateLimiter", () => {
  it("runs a single call immediately on a fresh instance (no artificial delay for the very first call)", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 5_000 });
    const start = Date.now();
    const result = await limiter.run(async () => "real result");
    expect(result).toBe("real result");
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("paces a second call to be at least minCallIntervalMs after the first", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 200 });
    const timestamps: number[] = [];
    await limiter.run(async () => {
      timestamps.push(Date.now());
    });
    await limiter.run(async () => {
      timestamps.push(Date.now());
    });
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(190); // small tolerance for timer jitter
  });

  it("retries exactly once (bounded, never infinite) on a rate-limit (429/RESOURCE_EXHAUSTED) error, then succeeds", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0, defaultRetryDelayMs: 0, retryDelayCapMs: 0 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota exceeded"}}'))
      .mockResolvedValueOnce("succeeded on retry");

    const result = await limiter.run(fn);

    expect(result).toBe("succeeded on retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries exactly once on a 503 UNAVAILABLE (overloaded) error, then succeeds", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"model overloaded"}}'))
      .mockResolvedValueOnce("succeeded on retry");

    const result = await limiter.run(fn);

    expect(result).toBe("succeeded on retry");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries more than the bounded maxRetries -- throws the real error after exhausting retries, never an infinite loop", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0, defaultRetryDelayMs: 0, maxRetries: 1 });
    const persistentError = new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota exceeded"}}');
    const fn = vi.fn().mockRejectedValue(persistentError);

    await expect(limiter.run(fn)).rejects.toBe(persistentError);
    expect(fn).toHaveBeenCalledTimes(2); // 1 initial attempt + 1 bounded retry, never more
  });

  it("does NOT retry a real error unrelated to rate limiting/overload -- propagates immediately", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0 });
    const realError = new Error("invalid API key");
    const fn = vi.fn().mockRejectedValue(realError);

    await expect(limiter.run(fn)).rejects.toBe(realError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a real per-day quota failure -- fails immediately, since waiting seconds can't fix a daily cap", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0 });
    const fn = vi.fn().mockRejectedValue(new Error(DAILY_QUOTA_ERROR_TEXT));

    await expect(limiter.run(fn)).rejects.toBeInstanceOf(GeminiDailyQuotaExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1); // no bounded retry attempted for a daily-quota failure
  });

  it("short-circuits every further call for the rest of the day once a real daily-quota failure is observed -- never a repeated guaranteed-to-fail network call", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0 });
    const fn = vi.fn().mockRejectedValue(new Error(DAILY_QUOTA_ERROR_TEXT));

    await expect(limiter.run(fn)).rejects.toBeInstanceOf(GeminiDailyQuotaExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);

    // A second, third, fourth call must fail immediately WITHOUT ever invoking fn again.
    await expect(limiter.run(fn)).rejects.toBeInstanceOf(GeminiDailyQuotaExhaustedError);
    await expect(limiter.run(fn)).rejects.toBeInstanceOf(GeminiDailyQuotaExhaustedError);
    await expect(limiter.run(fn)).rejects.toBeInstanceOf(GeminiDailyQuotaExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1); // still just the one real attempt that discovered it
    expect(limiter.isDailyQuotaExhausted()).toBe(true);
  });

  it("a fresh limiter instance (e.g. a new day) is NOT considered daily-quota-exhausted", () => {
    const limiter = new GeminiRateLimiter();
    expect(limiter.isDailyQuotaExhausted()).toBe(false);
  });

  it("caps the retry delay it waits, even when Google's own response names a very long retryDelay", async () => {
    const limiter = new GeminiRateLimiter({ minCallIntervalMs: 0, retryDelayCapMs: 50 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"quota exceeded","retryDelay":"9999s"}}'))
      .mockResolvedValueOnce("ok");

    const start = Date.now();
    const result = await limiter.run(fn);
    expect(result).toBe("ok");
    expect(Date.now() - start).toBeLessThan(1000); // real cap of 50ms respected, not a 9999s wait
  });
});
