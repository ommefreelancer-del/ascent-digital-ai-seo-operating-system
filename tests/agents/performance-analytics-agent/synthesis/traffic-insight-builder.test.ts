import { describe, expect, it } from "vitest";
import { TrafficInsightBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/traffic-insight-builder.js";
import type { TrafficSnapshot } from "../../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";

function makeSnapshot(overrides: Partial<TrafficSnapshot> = {}): TrafficSnapshot {
  return { organicSessions: 100, previousOrganicSessions: 100, conversions: 5, averageConversionValue: 50, ...overrides };
}

describe("TrafficInsightBuilder", () => {
  const builder = new TrafficInsightBuilder();

  it("returns null when no traffic snapshot was supplied", () => {
    expect(builder.build(null)).toBeNull();
  });

  it("marks a higher session count than before as improving", () => {
    const insight = builder.build(makeSnapshot({ organicSessions: 150, previousOrganicSessions: 100 }));
    expect(insight?.trend).toBe("improving");
  });

  it("marks a lower session count than before as declining", () => {
    const insight = builder.build(makeSnapshot({ organicSessions: 50, previousOrganicSessions: 100 }));
    expect(insight?.trend).toBe("declining");
  });

  it("marks an unchanged session count as stable", () => {
    const insight = builder.build(makeSnapshot({ organicSessions: 100, previousOrganicSessions: 100 }));
    expect(insight?.trend).toBe("stable");
  });

  it("marks trend unknown when there is no previous session count", () => {
    const insight = builder.build(makeSnapshot({ previousOrganicSessions: null }));
    expect(insight?.trend).toBe("unknown");
  });

  it("passes through the real conversions figure, including null", () => {
    expect(builder.build(makeSnapshot({ conversions: 7 }))?.conversions).toBe(7);
    expect(builder.build(makeSnapshot({ conversions: null }))?.conversions).toBeNull();
  });
});
