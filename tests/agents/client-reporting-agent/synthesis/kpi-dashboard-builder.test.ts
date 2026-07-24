import { describe, expect, it } from "vitest";
import { KpiDashboardBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/kpi-dashboard-builder.js";
import type { PerformanceAnalyticsResult } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";

function makePerformanceAnalytics(overrides: Partial<PerformanceAnalyticsResult> = {}): PerformanceAnalyticsResult {
  return {
    requestId: "pa-1",
    url: "https://oursite.com",
    dataAvailable: true,
    rankingInsights: [],
    trafficInsight: null,
    coreWebVitalInsights: [],
    opportunities: [],
    roiInsight: null,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KpiDashboardBuilder", () => {
  const builder = new KpiDashboardBuilder();

  it("returns no entries when there is no real data at all", () => {
    expect(builder.build(makePerformanceAnalytics(), [])).toEqual([]);
  });

  it("includes organic sessions with the real trend when traffic data exists", () => {
    const entries = builder.build(
      makePerformanceAnalytics({ trafficInsight: { organicSessions: 200, trend: "improving", conversions: null } }),
      [],
    );
    expect(entries).toContainEqual({ label: "Organic Sessions", value: "200", trend: "improving" });
  });

  it("includes conversions only when the real figure is known", () => {
    const withConversions = builder.build(
      makePerformanceAnalytics({ trafficInsight: { organicSessions: 200, trend: "stable", conversions: 5 } }),
      [],
    );
    const withoutConversions = builder.build(
      makePerformanceAnalytics({ trafficInsight: { organicSessions: 200, trend: "stable", conversions: null } }),
      [],
    );
    expect(withConversions.some((e) => e.label === "Conversions")).toBe(true);
    expect(withoutConversions.some((e) => e.label === "Conversions")).toBe(false);
  });

  it("counts improving and declining keywords from real ranking insights", () => {
    const entries = builder.build(
      makePerformanceAnalytics({
        rankingInsights: [
          { keyword: "a", currentPosition: 5, previousPosition: 10, trend: "improving", isPageOneOpportunity: false },
          { keyword: "b", currentPosition: 15, previousPosition: 5, trend: "declining", isPageOneOpportunity: true },
        ],
      }),
      [],
    );
    expect(entries).toContainEqual({ label: "Keywords Improving", value: "1", trend: "unknown" });
    expect(entries).toContainEqual({ label: "Keywords Declining", value: "1", trend: "unknown" });
  });

  it("summarizes real Core Web Vitals as a passing fraction", () => {
    const entries = builder.build(
      makePerformanceAnalytics({
        coreWebVitalInsights: [
          { metric: "LCP", value: 2000, threshold: 2500, passesThreshold: true },
          { metric: "INP", value: 300, threshold: 200, passesThreshold: false },
        ],
      }),
      [],
    );
    expect(entries).toContainEqual({ label: "Core Web Vitals Passing", value: "1/2", trend: "unknown" });
  });

  it("passes through real, caller-supplied business KPIs verbatim", () => {
    const entries = builder.build(makePerformanceAnalytics(), [{ label: "Monthly Revenue", value: "$12,450" }]);
    expect(entries).toContainEqual({ label: "Monthly Revenue", value: "$12,450", trend: "unknown" });
  });
});
