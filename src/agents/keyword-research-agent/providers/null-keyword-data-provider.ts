// The default KeywordDataProvider: honestly reports that no real keyword
// metrics are available, rather than fabricating any. This is what
// KeywordResearchAgent.create() uses until a real provider (Ahrefs, SEMrush,
// Google Keyword Planner, Google Trends, Google Search Console, etc.) is
// deliberately wired in and approved per GLOBAL_RULES.md SS9 ("connecting
// external services" requires human approval).

import type { KeywordDataProvider, KeywordMetrics, KeywordMetricsRequest } from "../types/keyword-data-provider.types.js";

export class NullKeywordDataProvider implements KeywordDataProvider {
  readonly name = "none-configured";

  async fetchMetrics(_request: KeywordMetricsRequest): Promise<KeywordMetrics | null> {
    return null;
  }
}
