import { describe, expect, it } from "vitest";
import { ClientRecommendationBuilder } from "../../../../src/agents/client-reporting-agent/synthesis/client-recommendation-builder.js";
import type { PerformanceAnalyticsResult } from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";
import type { SeoStrategyResult } from "../../../../src/agents/seo-strategy-agent/types/seo-strategy-request.types.js";

function makePerformanceAnalytics(recommendations: PerformanceAnalyticsResult["recommendations"] = []): PerformanceAnalyticsResult {
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
    recommendations,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeSeoStrategy(quickWins: SeoStrategyResult["prioritizationMatrix"]["quickWins"] = []): SeoStrategyResult {
  return {
    requestId: "ss-1",
    strategy: [],
    prioritizationMatrix: { quickWins, majorProjects: [], fillIns: [], thankless: [] },
    roadmap: { phases: [], deprioritized: [] },
    implementationPlan: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

describe("ClientRecommendationBuilder", () => {
  const builder = new ClientRecommendationBuilder();

  it("falls back to real Performance Analytics recommendations when no SeoStrategyResult is supplied", () => {
    const recommendations = builder.build(
      makePerformanceAnalytics([{ category: "ranking", priority: "high", recommendation: "Close the gap.", rationale: "x" }]),
      undefined,
    );
    expect(recommendations).toEqual([{ priority: "high", recommendation: "Close the gap.", rationale: "x" }]);
  });

  it("prefers real SeoStrategy quick wins when a SeoStrategyResult is supplied", () => {
    const quickWin = {
      id: "item-1",
      source: "technical-seo",
      category: "https",
      description: "Migrate to HTTPS.",
      rationale: "Uses http://.",
      impact: "high" as const,
      effort: "low" as const,
      confirmedBySources: [],
      priorityScore: 3,
    };
    const recommendations = builder.build(makePerformanceAnalytics([]), makeSeoStrategy([quickWin]));

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ priority: "high", recommendation: "Migrate to HTTPS." });
    expect(recommendations[0]?.rationale).toContain("Uses http://.");
  });

  it("returns no recommendations when neither source has anything real to report", () => {
    expect(builder.build(makePerformanceAnalytics([]), makeSeoStrategy([]))).toEqual([]);
  });
});
