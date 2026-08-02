import { describe, expect, it } from "vitest";
import { AchievementChallengeBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/achievement-challenge-builder.js";
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
    lighthouseCategoryScores: null,
    opportunities: [],
    roiInsight: null,
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWebsiteAudit(criticalCount: number): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://oursite.com",
    findings: [],
    summary: { criticalCount, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("AchievementChallengeBuilder", () => {
  const builder = new AchievementChallengeBuilder();

  it("surfaces an achievement for an improving keyword", () => {
    const items = builder.build(
      makePerformanceAnalytics({
        rankingInsights: [{ keyword: "plumber", currentPosition: 5, previousPosition: 10, trend: "improving", isPageOneOpportunity: false }],
      }),
      makeWebsiteAudit(0),
    );
    expect(items).toContainEqual({ type: "achievement", description: '"plumber" improved from position 10 to 5.' });
  });

  it("surfaces a challenge for a declining keyword", () => {
    const items = builder.build(
      makePerformanceAnalytics({
        rankingInsights: [{ keyword: "plumber", currentPosition: 15, previousPosition: 5, trend: "declining", isPageOneOpportunity: false }],
      }),
      makeWebsiteAudit(0),
    );
    expect(items).toContainEqual({ type: "challenge", description: '"plumber" declined from position 5 to 15.' });
  });

  it("surfaces a traffic achievement or challenge based on the real trend", () => {
    const improving = builder.build(
      makePerformanceAnalytics({ trafficInsight: { organicSessions: 300, trend: "improving", conversions: null } }),
      makeWebsiteAudit(0),
    );
    const declining = builder.build(
      makePerformanceAnalytics({ trafficInsight: { organicSessions: 100, trend: "declining", conversions: null } }),
      makeWebsiteAudit(0),
    );
    expect(improving.some((i) => i.type === "achievement" && i.description.includes("increased"))).toBe(true);
    expect(declining.some((i) => i.type === "challenge" && i.description.includes("decreased"))).toBe(true);
  });

  it("surfaces a challenge when critical website issues remain, otherwise an achievement", () => {
    const withCritical = builder.build(makePerformanceAnalytics(), makeWebsiteAudit(3));
    const withoutCritical = builder.build(makePerformanceAnalytics(), makeWebsiteAudit(0));
    expect(withCritical).toContainEqual({ type: "challenge", description: "3 critical website issue(s) remain unresolved." });
    expect(withoutCritical).toContainEqual({ type: "achievement", description: "No critical website issues are currently outstanding." });
  });

  it("surfaces a challenge for each failing real Core Web Vital", () => {
    const items = builder.build(
      makePerformanceAnalytics({ coreWebVitalInsights: [{ metric: "CLS", value: 0.3, threshold: 0.1, passesThreshold: false }] }),
      makeWebsiteAudit(0),
    );
    expect(items.some((i) => i.type === "challenge" && i.description.includes("CLS"))).toBe(true);
  });
});
