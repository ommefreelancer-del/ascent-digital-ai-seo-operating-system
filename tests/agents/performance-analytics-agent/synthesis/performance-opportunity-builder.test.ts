import { describe, expect, it } from "vitest";
import { PerformanceOpportunityBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/performance-opportunity-builder.js";
import type {
  CoreWebVitalInsight,
  RankingInsight,
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

describe("PerformanceOpportunityBuilder", () => {
  const builder = new PerformanceOpportunityBuilder();

  it("returns no opportunities when nothing in the real data warrants one", () => {
    const opportunities = builder.build([makeRankingInsight()], null, []);
    expect(opportunities).toHaveLength(0);
  });

  it("surfaces a high-priority ranking opportunity for a page-one-opportunity keyword", () => {
    const opportunities = builder.build(
      [makeRankingInsight({ isPageOneOpportunity: true, currentPosition: 15 })],
      null,
      [],
    );
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ category: "ranking", priority: "high" });
  });

  it("surfaces a medium-priority opportunity for a declining keyword", () => {
    const opportunities = builder.build(
      [makeRankingInsight({ trend: "declining", currentPosition: 10, previousPosition: 5 })],
      null,
      [],
    );
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ category: "ranking-decline", priority: "medium" });
  });

  it("surfaces a high-priority opportunity for declining traffic", () => {
    const trafficInsight: TrafficInsight = { organicSessions: 50, trend: "declining", conversions: null };
    const opportunities = builder.build([], trafficInsight, []);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ category: "traffic-decline", priority: "high" });
  });

  it("does not surface a traffic opportunity when traffic is stable or improving", () => {
    const stable: TrafficInsight = { organicSessions: 50, trend: "stable", conversions: null };
    expect(builder.build([], stable, [])).toHaveLength(0);
  });

  it("surfaces a high-priority opportunity for a failing Core Web Vital", () => {
    const failing: CoreWebVitalInsight = { metric: "LCP", value: 3000, threshold: 2500, passesThreshold: false };
    const opportunities = builder.build([], null, [failing]);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ category: "core-web-vitals", priority: "high" });
  });

  it("does not surface an opportunity for a passing Core Web Vital", () => {
    const passing: CoreWebVitalInsight = { metric: "LCP", value: 2000, threshold: 2500, passesThreshold: true };
    expect(builder.build([], null, [passing])).toHaveLength(0);
  });
});
