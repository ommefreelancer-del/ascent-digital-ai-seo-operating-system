// The seam between "the agent needs real keyword metrics" and "where those
// metrics actually come from". GLOBAL_RULES.md SS2 (Anti-Hallucination Policy)
// forbids fabricating search volume, difficulty, or any other keyword metric.
// No concrete provider backed by a real data source (Ahrefs, SEMrush, Google
// Keyword Planner, Google Trends, Google Search Console) ships in this
// build -- only the interface and a NullKeywordDataProvider that honestly
// reports "unavailable" (see providers/null-keyword-data-provider.ts). A real
// provider can be plugged in later without changing KeywordResearchAgent.

export interface KeywordMetricsRequest {
  readonly keyword: string;
}

/** Real, verified metrics for one keyword. Never constructed from a guess. */
export interface KeywordMetrics {
  readonly keyword: string;
  readonly searchVolume: number;
  readonly difficulty: number;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface KeywordDataProvider {
  readonly name: string;
  /**
   * Resolves to the real metrics for `request.keyword`, or `null` if no
   * metrics are available (no provider configured, keyword not found, etc).
   * Implementations must never invent a value here -- `null` is always the
   * correct response when genuine data cannot be obtained.
   */
  fetchMetrics(request: KeywordMetricsRequest): Promise<KeywordMetrics | null>;
}
