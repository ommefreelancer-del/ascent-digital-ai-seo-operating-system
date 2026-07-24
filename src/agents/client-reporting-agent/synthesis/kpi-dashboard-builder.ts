// Builds a client-facing KPI dashboard from real, already-measured
// Performance Analytics figures plus real, caller-supplied business KPIs.
// Entries are included only when the underlying real data exists -- no
// entry is ever backfilled with an invented number. Trend is "unknown"
// wherever no real comparative signal exists (e.g. a single conversion
// count with no prior-period figure to compare against).

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { BusinessKpiEntry, KpiDashboardEntry } from "../types/client-reporting-request.types.js";

export class KpiDashboardBuilder {
  build(performanceAnalytics: PerformanceAnalyticsResult, businessKpis: readonly BusinessKpiEntry[]): KpiDashboardEntry[] {
    const entries: KpiDashboardEntry[] = [];

    const traffic = performanceAnalytics.trafficInsight;
    if (traffic) {
      entries.push({ label: "Organic Sessions", value: String(traffic.organicSessions), trend: traffic.trend });
      if (traffic.conversions !== null) {
        entries.push({ label: "Conversions", value: String(traffic.conversions), trend: "unknown" });
      }
    }

    const rankings = performanceAnalytics.rankingInsights;
    if (rankings.length > 0) {
      const improving = rankings.filter((r) => r.trend === "improving").length;
      const declining = rankings.filter((r) => r.trend === "declining").length;
      entries.push({ label: "Keywords Improving", value: String(improving), trend: "unknown" });
      entries.push({ label: "Keywords Declining", value: String(declining), trend: "unknown" });
    }

    const vitals = performanceAnalytics.coreWebVitalInsights;
    if (vitals.length > 0) {
      const passing = vitals.filter((v) => v.passesThreshold).length;
      entries.push({ label: "Core Web Vitals Passing", value: `${passing}/${vitals.length}`, trend: "unknown" });
    }

    for (const kpi of businessKpis) {
      entries.push({ label: kpi.label, value: kpi.value, trend: "unknown" });
    }

    return entries;
  }
}
