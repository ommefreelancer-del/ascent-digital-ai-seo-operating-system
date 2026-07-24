import { describe, expect, it } from "vitest";
import { InternalLinkingRecommender } from "../../../../src/agents/content-strategy-agent/planning/internal-linking-recommender.js";
import type { PillarPageStrategyEntry } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeEntry(overrides: Partial<PillarPageStrategyEntry> = {}): PillarPageStrategyEntry {
  return {
    clusterLabel: "plumber",
    pillarKeyword: "plumber",
    pillarTitle: "The Complete Guide to Plumber",
    pillarIntent: "informational",
    supportingArticles: [
      { keyword: "emergency plumber", intent: "informational", suggestedTitle: "A Complete Guide to Emergency Plumber" },
    ],
    priorityRank: 1,
    ...overrides,
  };
}

describe("InternalLinkingRecommender", () => {
  const recommender = new InternalLinkingRecommender();

  it("recommends a link from the pillar to each supporting article", () => {
    const recommendations = recommender.build([makeEntry()]);

    const pillarToSupporting = recommendations.find(
      (r) => r.fromTitle === "The Complete Guide to Plumber" && r.toTitle === "A Complete Guide to Emergency Plumber",
    );
    expect(pillarToSupporting).toBeDefined();
  });

  it("recommends a link back from each supporting article to the pillar", () => {
    const recommendations = recommender.build([makeEntry()]);

    const supportingToPillar = recommendations.find(
      (r) => r.fromTitle === "A Complete Guide to Emergency Plumber" && r.toTitle === "The Complete Guide to Plumber",
    );
    expect(supportingToPillar).toBeDefined();
  });

  it("produces exactly two recommendations per supporting article", () => {
    const entry = makeEntry({
      supportingArticles: [
        { keyword: "a", intent: "informational", suggestedTitle: "Title A" },
        { keyword: "b", intent: "informational", suggestedTitle: "Title B" },
      ],
    });

    expect(recommender.build([entry])).toHaveLength(4);
  });

  it("returns an empty array for a pillar with no supporting articles", () => {
    const entry = makeEntry({ supportingArticles: [] });
    expect(recommender.build([entry])).toEqual([]);
  });
});
