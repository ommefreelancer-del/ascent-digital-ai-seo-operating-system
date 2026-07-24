import { describe, expect, it } from "vitest";
import { RoiInsightBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/roi-insight-builder.js";
import type { TrafficSnapshot } from "../../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";

function makeSnapshot(overrides: Partial<TrafficSnapshot> = {}): TrafficSnapshot {
  return { organicSessions: 100, previousOrganicSessions: 100, conversions: 5, averageConversionValue: 50, ...overrides };
}

describe("RoiInsightBuilder", () => {
  const builder = new RoiInsightBuilder();

  it("returns null when there is no traffic snapshot", () => {
    expect(builder.build(null)).toBeNull();
  });

  it("returns null when conversions are unavailable", () => {
    expect(builder.build(makeSnapshot({ conversions: null }))).toBeNull();
  });

  it("returns null when average conversion value is unavailable", () => {
    expect(builder.build(makeSnapshot({ averageConversionValue: null }))).toBeNull();
  });

  it("computes estimatedRevenue as conversions x averageConversionValue from real inputs only", () => {
    const insight = builder.build(makeSnapshot({ conversions: 5, averageConversionValue: 50 }));
    expect(insight).toMatchObject({ conversions: 5, averageConversionValue: 50, estimatedRevenue: 250 });
    expect(insight?.basis).toContain("5 measured conversion(s)");
  });
});
