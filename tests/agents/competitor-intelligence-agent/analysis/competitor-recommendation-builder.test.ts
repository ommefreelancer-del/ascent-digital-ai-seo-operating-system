import { describe, expect, it } from "vitest";
import { CompetitorRecommendationBuilder } from "../../../../src/agents/competitor-intelligence-agent/analysis/competitor-recommendation-builder.js";
import type {
  CompetitorTechnicalComparison,
  ContentClusterCoverage,
} from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeComparison(overrides: Partial<CompetitorTechnicalComparison> = {}): CompetitorTechnicalComparison {
  return {
    competitorId: "competitor-a",
    competitorUrl: null,
    categories: [
      { category: "crawlability", ourIssueCount: 0, competitorIssueCount: 0, advantage: "tie" },
      { category: "robots-txt", ourIssueCount: 0, competitorIssueCount: 0, advantage: "tie" },
      { category: "https", ourIssueCount: 1, competitorIssueCount: 0, advantage: "competitor" },
      { category: "page-structure", ourIssueCount: 0, competitorIssueCount: 0, advantage: "tie" },
    ],
    ...overrides,
  };
}

describe("CompetitorRecommendationBuilder", () => {
  const builder = new CompetitorRecommendationBuilder();

  it("recommends addressing a category where a competitor has the advantage", () => {
    const recommendations = builder.build([makeComparison()], []);
    expect(recommendations.some((r) => r.category === "https")).toBe(true);
  });

  it("does not recommend a category where nobody has the competitor advantage", () => {
    const recommendations = builder.build(
      [makeComparison({ categories: [{ category: "https", ourIssueCount: 0, competitorIssueCount: 0, advantage: "tie" }] })],
      [],
    );
    expect(recommendations).toEqual([]);
  });

  it("cites every competitor with the advantage, deduplicated per category", () => {
    const recommendations = builder.build(
      [makeComparison({ competitorId: "a" }), makeComparison({ competitorId: "b" })],
      [],
    );
    const httpsRecommendation = recommendations.find((r) => r.category === "https");
    expect(httpsRecommendation?.recommendation).toContain("a");
    expect(httpsRecommendation?.recommendation).toContain("b");
    expect(recommendations.filter((r) => r.category === "https")).toHaveLength(1);
  });

  it("recommends a content cluster covered by 2 or more competitors", () => {
    const coverage: ContentClusterCoverage[] = [
      { clusterLabel: "plumber", keywords: ["plumber"], coveredByCompetitors: ["a", "b"] },
    ];
    const recommendations = builder.build([], coverage);
    expect(recommendations.some((r) => r.category === "content-gap" && r.recommendation.includes("plumber"))).toBe(
      true,
    );
  });

  it("does not recommend a content cluster covered by only 1 competitor", () => {
    const coverage: ContentClusterCoverage[] = [
      { clusterLabel: "plumber", keywords: ["plumber"], coveredByCompetitors: ["a"] },
    ];
    expect(builder.build([], coverage)).toEqual([]);
  });

  it("never quotes competitor content verbatim, only cites ids and counts", () => {
    const recommendations = builder.build([makeComparison()], []);
    // Sanity: recommendation text should reference the competitor id, not any raw HTML/text.
    expect(recommendations[0]?.recommendation).not.toMatch(/<[^>]+>/);
  });
});
