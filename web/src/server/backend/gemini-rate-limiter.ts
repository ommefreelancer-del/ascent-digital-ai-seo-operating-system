// Web-layer copy of src/agents/seo-content-agent/providers/gemini-rate-limiter.ts's exact pacing +
// bounded-retry + daily-quota-circuit-breaker design. Duplicated rather than imported because
// @google/genai-backed calls made directly from this layer (image-concepts.ts's own concept-
// derivation/relevance-judgment calls, which use @anthropic-ai/sdk and @google/genai directly, the same
// way specialist-ai.ts does, rather than going through the SeoContentAgent/ContentStrategyAgent provider
// seam) cannot statically import agent-layer TypeScript source -- see content.ts's own header for why
// every OTHER cross-layer agent import in this file goes through a dynamic dist/src import instead. This
// file's logic must stay in sync with its agent-layer sibling by hand if the pacing/retry/circuit-breaker
// policy ever changes.
//
// See that file for the full rationale: Gemini's free tier has TWO quota ceilings (observed live: 5
// requests/minute/model AND 20 requests/day/model). A per-minute failure is worth a single bounded
// retry; a per-day failure is NOT -- no amount of waiting seconds/minutes fixes it today, so once
// observed, this limiter short-circuits every further call for the rest of the day rather than wasting
// a pacing wait + a network call guaranteed to fail.

const DEFAULT_MIN_CALL_INTERVAL_MS = 13_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_CAP_MS = 20_000;
const DEFAULT_RETRY_DELAY_MS = 15_000;
const OVERLOAD_RETRY_DELAY_MS = 3_000;

export interface GeminiRateLimiterOptions {
  readonly minCallIntervalMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayCapMs?: number;
  readonly defaultRetryDelayMs?: number;
}

/** Thrown immediately (no retry, no wait) once this limiter has observed a real per-DAY quota exhaustion for today. */
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

function parseRetryDelayMs(error: unknown): number | null {
  const match = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(errorText(error));
  return match ? Math.ceil(parseFloat(match[1]!) * 1000) : null;
}

export class GeminiRateLimiter {
  private readonly minCallIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayCapMs: number;
  private readonly defaultRetryDelayMs: number;
  private lastCallStartedAt = 0;
  private dailyQuotaExhaustedOnDate: string | null = null;

  constructor(options: GeminiRateLimiterOptions = {}) {
    this.minCallIntervalMs = options.minCallIntervalMs ?? DEFAULT_MIN_CALL_INTERVAL_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayCapMs = options.retryDelayCapMs ?? DEFAULT_RETRY_DELAY_CAP_MS;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

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
