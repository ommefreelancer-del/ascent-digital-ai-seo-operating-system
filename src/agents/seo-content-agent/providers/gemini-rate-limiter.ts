// Google's Gemini Developer API free tier has TWO separate quota ceilings, both observed live against
// this exact key/model:
//   - 5 requests/minute/model  ("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")
//   - 20 requests/day/model    ("GenerateRequestsPerDayPerProjectPerModel-FreeTier")
// A single article-generation request can need dozens of real Gemini calls (outline, several sections,
// meta, FAQ questions/answers, QA passes) once Anthropic billing fails and every one of them routes to
// Gemini -- calling them back-to-back blows through the per-minute cap almost immediately, and a
// single article (or a few articles across a day) can blow through the per-day cap outright. Every
// Gemini-backed provider that can fire repeatedly within one request shares ONE instance of this
// limiter (constructed once in web/src/server/backend/content.ts and passed to both the content and
// outline Gemini providers) so the whole pipeline paces itself against the same real quota, instead of
// each call site guessing independently.
//
// Three deliberately bounded, never-infinite mechanisms:
// 1. PACING: before every call, wait however long is needed so calls started on this limiter are spaced
//    at least MIN_CALL_INTERVAL_MS apart -- proactively avoids hitting the per-minute limit rather than
//    reacting after the fact.
// 2. BOUNDED RETRY: if a per-minute 429 (RESOURCE_EXHAUSTED) or a 503 (UNAVAILABLE/overloaded) slips
//    through anyway, retry AT MOST ONCE, waiting for whatever delay Google's own error response names
//    (capped) -- never an uncontrolled loop, never a full article regenerated.
// 3. DAILY-QUOTA CIRCUIT BREAKER: a per-DAY 429 is a fundamentally different failure than a per-minute
//    one -- no amount of waiting seconds or minutes will make it succeed again today, so retrying it (even
//    once) just wastes time guaranteed to fail. The FIRST time this limiter observes one, it remembers
//    "exhausted for the rest of today" and every subsequent call through this SAME instance fails
//    immediately -- no pacing wait, no network call, no retry -- until the wall-clock date changes. This
//    protects the rest of the current article's calls, and every later request sharing this same
//    (process-lifetime singleton) instance, from hammering a quota already known to be dead for today.
const DEFAULT_MIN_CALL_INTERVAL_MS = 13_000; // 60_000 / 5 requests-per-minute, plus a small safety margin
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_CAP_MS = 20_000;
const DEFAULT_RETRY_DELAY_MS = 15_000; // used when a 429's own response doesn't name a retry delay
const OVERLOAD_RETRY_DELAY_MS = 3_000; // a 503 "high demand" failure doesn't name a delay; a short fixed wait is enough

export interface GeminiRateLimiterOptions {
  /** Minimum spacing enforced between calls made through this limiter. */
  readonly minCallIntervalMs?: number;
  /** How many additional attempts a rate-limited/overloaded call gets, beyond the first -- bounded, never infinite. */
  readonly maxRetries?: number;
  readonly retryDelayCapMs?: number;
  readonly defaultRetryDelayMs?: number;
}

/** Thrown immediately (no retry, no wait) once this limiter has observed a real per-DAY quota exhaustion for today -- callers treat this exactly like any other Gemini failure (return null), but it short-circuits before wasting a pacing wait or a network call guaranteed to fail. */
export class GeminiDailyQuotaExhaustedError extends Error {
  constructor() {
    super("Gemini free-tier daily quota is already known to be exhausted for today -- not attempting further calls until it resets");
    this.name = "GeminiDailyQuotaExhaustedError";
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A per-DAY quota failure -- Google's own quotaId names the "PerDay" dimension explicitly, distinct from the per-minute one. Checked BEFORE the generic rate-limit check since a daily failure is also a 429/RESOURCE_EXHAUSTED. */
function isDailyQuotaError(error: unknown): boolean {
  return /PerDay/i.test(errorText(error));
}

function isRateLimitError(error: unknown): boolean {
  const text = errorText(error);
  return /"code":\s*429/.test(text) || /RESOURCE_EXHAUSTED/i.test(text);
}

function isOverloadedError(error: unknown): boolean {
  const text = errorText(error);
  return /"code":\s*503/.test(text) || /\bUNAVAILABLE\b/.test(text);
}

/** Parses Google's own `"retryDelay": "29s"` field out of the real error body, when present. */
function parseRetryDelayMs(error: unknown): number | null {
  const match = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(errorText(error));
  return match ? Math.ceil(parseFloat(match[1]!) * 1000) : null;
}

/**
 * One instance should be shared by every Gemini call site that can fire within the same real
 * article-generation request. Call `run(fn)` instead of calling the Gemini SDK directly; `fn` should
 * perform exactly one real API call and either resolve with its result or throw the SDK's own real error.
 */
export class GeminiRateLimiter {
  private readonly minCallIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayCapMs: number;
  private readonly defaultRetryDelayMs: number;
  private lastCallStartedAt = 0;
  // Set once a real per-day quota failure is observed; a plain wall-clock date string (not a timer) so
  // this correctly and automatically stops treating today's exhaustion as still active once the date
  // rolls over, with no restart or scheduled reset needed.
  private dailyQuotaExhaustedOnDate: string | null = null;

  constructor(options: GeminiRateLimiterOptions = {}) {
    this.minCallIntervalMs = options.minCallIntervalMs ?? DEFAULT_MIN_CALL_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayCapMs = options.retryDelayCapMs ?? DEFAULT_RETRY_DELAY_CAP_MS;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /** True once a real daily-quota failure has been observed and today's date hasn't changed since. */
  isDailyQuotaExhausted(): boolean {
    return this.dailyQuotaExhaustedOnDate === new Date().toDateString();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isDailyQuotaExhausted()) {
      throw new GeminiDailyQuotaExhaustedError();
    }
    return this.attempt(fn, 0);
  }

  private async attempt<T>(fn: () => Promise<T>, retryCount: number): Promise<T> {
    const elapsed = Date.now() - this.lastCallStartedAt;
    if (elapsed < this.minCallIntervalMs) {
      await sleep(this.minCallIntervalMs - elapsed);
    }
    this.lastCallStartedAt = Date.now();

    try {
      return await fn();
    } catch (error) {
      if (isDailyQuotaError(error)) {
        this.dailyQuotaExhaustedOnDate = new Date().toDateString();
        console.error(
          "[GeminiRateLimiter] real per-day quota exhausted -- stopping further Gemini calls on this limiter for the " +
            "rest of today (never retrying a known-exhausted daily quota; will resume automatically once the date changes)",
        );
        throw new GeminiDailyQuotaExhaustedError();
      }

      const rateLimited = isRateLimitError(error);
      const overloaded = !rateLimited && isOverloadedError(error);
      if (retryCount < this.maxRetries && (rateLimited || overloaded)) {
        const delay = rateLimited ? Math.min(parseRetryDelayMs(error) ?? this.defaultRetryDelayMs, this.retryDelayCapMs) : OVERLOAD_RETRY_DELAY_MS;
        console.error(
          `[GeminiRateLimiter] ${rateLimited ? "rate limited" : "overloaded"} -- waiting ${delay}ms then retrying once ` +
            `(bounded: ${retryCount + 1}/${this.maxRetries} retries used, never infinite)`,
        );
        await sleep(delay);
        return this.attempt(fn, retryCount + 1);
      }
      throw error;
    }
  }
}
