import { describe, expect, it } from "vitest";
import { OffPageRecommendationBuilder } from "../../../../src/agents/off-page-seo-agent/synthesis/off-page-recommendation-builder.js";
import type {
  CompetitorAuthorityGap,
  ReferringDomainGrowthInsight,
  ToxicBacklinkInsight,
} from "../../../../src/agents/off-page-seo-agent/types/off-page-seo-request.types.js";

function makeGap(overrides: Partial<CompetitorAuthorityGap> = {}): CompetitorAuthorityGap {
  return {
    competitorId: "competitor-a",
    competitorUrl: "https://competitor-a.com",
    ourDomainAuthority: 30,
    competitorDomainAuthority: 50,
    assessment: "we_are_behind",
    ...overrides,
  };
}

describe("OffPageRecommendationBuilder", () => {
  const builder = new OffPageRecommendationBuilder();

  it("always includes a general link-building recommendation tied to the business objective", () => {
    const recommendations = builder.build(null, [], [], "Grow emergency plumbing leads.");
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ category: "link-building", priority: "medium" });
    expect(recommendations[0]?.recommendation).toContain("Grow emergency plumbing leads.");
  });

  it("recommends closing the gap when we are behind a competitor", () => {
    const recommendations = builder.build(null, [makeGap({ assessment: "we_are_behind" })], [], "x");
    const gapRecommendation = recommendations.find((r) => r.category === "authority-gap");
    expect(gapRecommendation).toMatchObject({ priority: "high" });
    expect(gapRecommendation?.recommendation).toContain("competitor-a");
  });

  it("recommends investigating a declining referring-domain trend", () => {
    const declining: ReferringDomainGrowthInsight = { totalReferringDomains: 80, previousTotalReferringDomains: 100, trend: "declining" };
    const recommendations = builder.build(declining, [], [], "x");
    expect(recommendations.find((r) => r.category === "referring-domain-decline")).toMatchObject({ priority: "high" });
  });

  it("recommends human review of flagged toxic backlinks without instructing an automatic disavow", () => {
    const toxicBacklinks: ToxicBacklinkInsight[] = [
      { domain: "spammy.example", linkingUrl: "https://spammy.example/page", anchorText: "click here" },
    ];
    const recommendations = builder.build(null, [], toxicBacklinks, "x");
    const disavowRecommendation = recommendations.find((r) => r.category === "disavow-review");
    expect(disavowRecommendation).toMatchObject({ priority: "high" });
    expect(disavowRecommendation?.recommendation).toContain("human reviewer");
    expect(disavowRecommendation?.recommendation).not.toMatch(/automatically disavow/i);
  });

  it("does not recommend disavow review when there are no toxic backlinks", () => {
    const recommendations = builder.build(null, [], [], "x");
    expect(recommendations.some((r) => r.category === "disavow-review")).toBe(false);
  });
});
