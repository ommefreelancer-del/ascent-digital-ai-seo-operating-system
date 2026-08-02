// A real PerformanceDataProvider backed by Google Lighthouse (via a locally
// launched headless Chrome, chrome-launcher). This is an explicit opt-in:
// PerformanceAnalyticsAgent.create() still defaults to
// NullPerformanceDataProvider (see ../providers/null-performance-data-provider.ts),
// consistent with GLOBAL_RULES.md SS9 ("connecting external services"
// requires deliberate configuration, not a silent default).
//
// Lighthouse supplies real, measured Core Web Vitals and category scores
// (Performance, Accessibility, Best Practices, SEO -- lab data, from an
// actual page load in a real browser) -- never a guess. It does not supply
// rankings or traffic, so those fields are always empty/null here, exactly
// like the Null provider; only coreWebVitals and categoryScores are ever
// populated.
//
// On any failure (Chrome fails to launch, the URL is unreachable, Lighthouse
// itself errors), this returns `null` rather than a partial/fabricated
// result -- the same "unavailable, not guessed" contract every provider in
// this codebase follows.
//
// chrome.kill() cleanup failures (observed in practice on Windows: an EPERM
// deleting Chrome's temp profile directory) must never override an
// already-decided return value or already-caught error -- a `finally` block
// that itself throws replaces whatever the `try`/`catch` produced, which
// would turn a successful (or honestly-null) result into an uncaught
// exception. Cleanup errors are swallowed for exactly this reason.

import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { assertPublicHttpUrl } from "../../../core/crawling/url-safety.js";
import type {
  CoreWebVitalsSnapshot,
  LighthouseCategoryScores,
  PerformanceData,
  PerformanceDataProvider,
  PerformanceMetricsRequest,
} from "../types/performance-data-provider.types.js";

export interface LighthousePerformanceDataProviderOptions {
  readonly chromeFlags?: readonly string[];
}

const DEFAULT_CHROME_FLAGS = ["--headless=new", "--no-sandbox", "--disable-gpu"];

interface LighthouseResult {
  readonly audits?: Record<string, { numericValue?: number }>;
  readonly categories?: Record<string, { score?: number | null }>;
}

function numericAuditValue(lhr: LighthouseResult, auditId: string): number | null {
  const value = lhr.audits?.[auditId]?.numericValue;
  return typeof value === "number" ? value : null;
}

/** Lighthouse reports category scores as 0-1; this project reports them as 0-100 (rounded), matching how Lighthouse's own UI displays them. */
function categoryScore(lhr: LighthouseResult, categoryId: string): number | null {
  const score = lhr.categories?.[categoryId]?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

export class LighthousePerformanceDataProvider implements PerformanceDataProvider {
  readonly name = "lighthouse";
  private readonly chromeFlags: readonly string[];

  constructor(options: LighthousePerformanceDataProviderOptions = {}) {
    this.chromeFlags = options.chromeFlags ?? DEFAULT_CHROME_FLAGS;
  }

  async fetchPerformanceData(request: PerformanceMetricsRequest): Promise<PerformanceData | null> {
    try {
      await assertPublicHttpUrl(request.url);
    } catch {
      return null;
    }

    let chrome: chromeLauncher.LaunchedChrome | null = null;
    try {
      chrome = await chromeLauncher.launch({ chromeFlags: [...this.chromeFlags] });
      const runnerResult = await lighthouse(request.url, {
        port: chrome.port,
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      const lhr = runnerResult?.lhr;
      if (!lhr) return null;

      const coreWebVitals: CoreWebVitalsSnapshot = {
        lcpMs: numericAuditValue(lhr, "largest-contentful-paint"),
        inpMs: numericAuditValue(lhr, "interaction-to-next-paint"),
        cls: numericAuditValue(lhr, "cumulative-layout-shift"),
      };

      const categoryScores: LighthouseCategoryScores = {
        performance: categoryScore(lhr, "performance"),
        accessibility: categoryScore(lhr, "accessibility"),
        bestPractices: categoryScore(lhr, "best-practices"),
        seo: categoryScore(lhr, "seo"),
      };

      return {
        url: request.url,
        rankings: [],
        traffic: null,
        coreWebVitals,
        categoryScores,
        source: this.name,
        retrievedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    } finally {
      try {
        await chrome?.kill();
      } catch {
        // Cleanup failure must not override the try/catch's already-decided result -- see the file-level comment.
      }
    }
  }
}
