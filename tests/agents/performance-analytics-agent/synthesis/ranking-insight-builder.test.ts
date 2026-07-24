import { describe, expect, it } from "vitest";
import { RankingInsightBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/ranking-insight-builder.js";
import type { KeywordRankingSnapshot } from "../../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";

function makeSnapshot(overrides: Partial<KeywordRankingSnapshot> = {}): KeywordRankingSnapshot {
  return { keyword: "plumber", position: 5, previousPosition: 6, impressions: 100, clicks: 10, ctr: 0.1, ...overrides };
}

describe("RankingInsightBuilder", () => {
  const builder = new RankingInsightBuilder();

  it("excludes keywords with no real current position", () => {
    const insights = builder.build([makeSnapshot({ position: null })]);
    expect(insights).toHaveLength(0);
  });

  it("marks a lower position number than before as improving", () => {
    const [insight] = builder.build([makeSnapshot({ position: 5, previousPosition: 10 })]);
    expect(insight?.trend).toBe("improving");
  });

  it("marks a higher position number than before as declining", () => {
    const [insight] = builder.build([makeSnapshot({ position: 10, previousPosition: 5 })]);
    expect(insight?.trend).toBe("declining");
  });

  it("marks an unchanged position as stable", () => {
    const [insight] = builder.build([makeSnapshot({ position: 5, previousPosition: 5 })]);
    expect(insight?.trend).toBe("stable");
  });

  it("marks trend unknown when there is no previous position", () => {
    const [insight] = builder.build([makeSnapshot({ position: 5, previousPosition: null })]);
    expect(insight?.trend).toBe("unknown");
  });

  it("flags positions 11-20 as page-one opportunities", () => {
    const [pos11, pos20, pos10, pos21] = builder.build([
      makeSnapshot({ keyword: "a", position: 11 }),
      makeSnapshot({ keyword: "b", position: 20 }),
      makeSnapshot({ keyword: "c", position: 10 }),
      makeSnapshot({ keyword: "d", position: 21 }),
    ]);
    expect(pos11?.isPageOneOpportunity).toBe(true);
    expect(pos20?.isPageOneOpportunity).toBe(true);
    expect(pos10?.isPageOneOpportunity).toBe(false);
    expect(pos21?.isPageOneOpportunity).toBe(false);
  });
});
