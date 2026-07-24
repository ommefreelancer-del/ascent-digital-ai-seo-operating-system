// The default PerformanceDataProvider: honestly reports that no real
// performance data is available, rather than fabricating any. This is what
// PerformanceAnalyticsAgent.create() uses until a real provider (Google
// Search Console, Google Analytics 4, Ahrefs, SEMrush, etc.) is deliberately
// wired in and approved per GLOBAL_RULES.md SS9 ("connecting external
// services" requires human approval).

import type {
  PerformanceData,
  PerformanceDataProvider,
  PerformanceMetricsRequest,
} from "../types/performance-data-provider.types.js";

export class NullPerformanceDataProvider implements PerformanceDataProvider {
  readonly name = "none-configured";

  async fetchPerformanceData(_request: PerformanceMetricsRequest): Promise<PerformanceData | null> {
    return null;
  }
}
