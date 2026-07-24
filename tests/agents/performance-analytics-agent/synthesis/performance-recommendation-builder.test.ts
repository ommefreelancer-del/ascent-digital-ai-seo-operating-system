import { describe, expect, it } from "vitest";
import { PerformanceRecommendationBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/performance-recommendation-builder.js";
import type {
  CoreWebVitalInsight,
  RankingInsight,
  RoiInsight,
  TrafficInsight,
} from "../../../../src/agents/performance-analytics-agent/types/performance-analytics-request.types.js";

function makeRankingInsight(overrides: Partial<RankingInsight> = {}): RankingInsight {
  return {
    keyword: "plumber",
    currentPosition: 5,
    previousPosition: 5,
    trend: "stable",
    isPageOneOpportunity: false,
    ...overrides,
  };
}

describe("PerformanceRecommendationBuilder", () => {
  const builder = new PerformanceRecommendationBuilder();

  it("returns no recommendations when nothing in the real data warrants one", () => {
    expect(builder.build([makeRankingInsight()], null, [], null)).toHaveLength(0);
  });

  it("recommends closing the gap for a page-one-opportunity keyword", () => {
    const recommendations = builder.build(
      [makeRankingInsight({ isPageOneOpportunity: true, currentPosition: 15 })],
      null,
      [],
      null,
    );
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.category).toBe("ranking");
    expect(recommendations[0]?.priority).toBe("high");
    expect(recommendations[0]?.recommendation).toContain("plumber");
  });

  it("recommends investigating a declining keyword", () => {
    const recommendations = builder.build(
      [makeRankingInsight({ trend: "declining", currentPosition: 10, previousPosition: 5 })],
      null,
      [],
      null,
    );
    expect(recommendations[0]).toMatchObject({ category: "ranking-decline", priority: "medium" });
  });

  it("recommends investigating declining traffic", () => {
    const trafficInsight: TrafficInsight = { organicSessions: 50, trend: "declining", conversions: null };
    const recommendations = builder.build([], trafficInsight, [], null);
    expect(recommendations[0]).toMatchObject({ category: "traffic-decline", priority: "high" });
  });

  it("recommends metric-specific guidance for each failing Core Web Vital", () => {
    const failing: CoreWebVitalInsight = { metric: "INP", value: 300, threshold: 200, passesThreshold: false };
    const recommendations = builder.build([], null, [failing], null);
    expect(recommendations[0]?.category).toBe("core-web-vitals");
    expect(recommendations[0]?.recommendation).toContain("INP");
  });

  it("adds an ROI-informed recommendation when a real ROI insight is present", () => {
    const roiInsight: RoiInsight = {
      conversions: 5,
      averageConversionValue: 50,
      estimatedRevenue: 250,
      basis: "Computed from 5 measured conversion(s).",
    };
    const recommendations = builder.build([], null, [], roiInsight);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ category: "roi", priority: "medium" });
    expect(recommendations[0]?.recommendation).toContain("250");
  });
});
