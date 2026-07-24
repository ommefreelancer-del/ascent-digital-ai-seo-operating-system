import { describe, expect, it } from "vitest";
import { ExecutiveSummaryBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/executive-summary-builder.js";
import type { PerformanceAnalyticsResult } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

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

function makeWebsiteAudit(criticalCount: number, warningCount: number): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com",
    findings: [],
    summary: { criticalCount, warningCount, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("ExecutiveSummaryBuilder", () => {
  const builder = new ExecutiveSummaryBuilder();

  it("names the real client and reporting period", () => {
    const summary = builder.build("Acme Plumbing", "July 2026", makePerformanceAnalytics(), makeWebsiteAudit(0, 0));
    expect(summary).toContain("Acme Plumbing");
    expect(summary).toContain("July 2026");
  });

  it("states real traffic figures when data is available", () => {
    const summary = builder.build(
      "Acme",
      "July 2026",
      makePerformanceAnalytics({ dataAvailable: true, trafficInsight: { organicSessions: 420, trend: "improving", conversions: 8 } }),
      makeWebsiteAudit(0, 0),
    );
    expect(summary).toContain("420");
    expect(summary).toContain("improving");
    expect(summary).toContain("8 tracked conversion(s)");
  });

  it("honestly states no performance data was available rather than omitting the sentence", () => {
    const summary = builder.build("Acme", "July 2026", makePerformanceAnalytics({ dataAvailable: false }), makeWebsiteAudit(0, 0));
    expect(summary).toContain("No measured performance data");
  });

  it("states the real critical and warning finding counts", () => {
    const summary = builder.build("Acme", "July 2026", makePerformanceAnalytics(), makeWebsiteAudit(2, 5));
    expect(summary).toContain("2 critical");
    expect(summary).toContain("5 warning");
  });
});
