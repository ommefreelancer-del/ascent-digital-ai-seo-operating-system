// The seam between "the agent needs real performance data" and "where that
// data actually comes from". GLOBAL_RULES.md SS2 (Anti-Hallucination Policy)
// forbids fabricating rankings, traffic, CTR, impressions, or conversions.
// No concrete provider backed by a real data source (Google Search Console,
// Google Analytics 4, Ahrefs, SEMrush) ships in this build -- only the
// interface and a NullPerformanceDataProvider that honestly reports
// "unavailable" (see providers/null-performance-data-provider.ts). A real
// provider can be plugged in later, once explicitly approved per
// GLOBAL_RULES.md SS9, without changing PerformanceAnalyticsAgent.

export interface PerformanceMetricsRequest {
  readonly url: string;
  readonly keywords: readonly string[];
}

/** One keyword's real, measured ranking snapshot. `null` fields mean genuinely unavailable, never a guess. */
export interface KeywordRankingSnapshot {
  readonly keyword: string;
  /** Current search results position (1 = top). `null` if the page is not ranking in the tracked results. */
  readonly position: number | null;
  /** Position as of the previous measurement. `null` if no prior measurement exists. */
  readonly previousPosition: number | null;
  readonly impressions: number | null;
  readonly clicks: number | null;
  /** Click-through rate as a 0-1 fraction. */
  readonly ctr: number | null;
}

/** Real, measured organic traffic and conversion figures for the page. */
export interface TrafficSnapshot {
  readonly organicSessions: number;
  /** Organic sessions as of the previous measurement period. `null` if no prior period is available. */
  readonly previousOrganicSessions: number | null;
  /** Count of real, measured conversions attributed to this page. `null` if conversion tracking is unavailable. */
  readonly conversions: number | null;
  /** Real average monetary value per conversion, in the business's own currency. `null` if unknown. */
  readonly averageConversionValue: number | null;
}

/** Real, measured Core Web Vitals for the page (field or lab data, per the provider). */
export interface CoreWebVitalsSnapshot {
  /** Largest Contentful Paint, in milliseconds. */
  readonly lcpMs: number | null;
  /** Interaction to Next Paint, in milliseconds. */
  readonly inpMs: number | null;
  /** Cumulative Layout Shift, a unitless score. */
  readonly cls: number | null;
}

/** Real, measured Lighthouse category scores for the page, 0-100 (rounded), per category. `null` per-field means that category was not measured. */
export interface LighthouseCategoryScores {
  readonly performance: number | null;
  readonly accessibility: number | null;
  readonly bestPractices: number | null;
  readonly seo: number | null;
}

export interface PerformanceData {
  readonly url: string;
  readonly rankings: readonly KeywordRankingSnapshot[];
  readonly traffic: TrafficSnapshot | null;
  readonly coreWebVitals: CoreWebVitalsSnapshot | null;
  /** Real, measured Lighthouse category scores, or `null` if this provider doesn't supply them. */
  readonly categoryScores: LighthouseCategoryScores | null;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface PerformanceDataProvider {
  readonly name: string;
  /**
   * Resolves to the real performance data for `request.url`, or `null` if no
   * data is available (no provider configured, page not found in the data
   * source, etc). Implementations must never invent a value here -- `null`
   * is always the correct response when genuine data cannot be obtained.
   */
  fetchPerformanceData(request: PerformanceMetricsRequest): Promise<PerformanceData | null>;
}
