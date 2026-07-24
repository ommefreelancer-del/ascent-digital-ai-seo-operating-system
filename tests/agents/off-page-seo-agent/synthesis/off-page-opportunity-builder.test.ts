import { describe, expect, it } from "vitest";
import { OffPageOpportunityBuilder } from "../../../../src/agents/off-page-seo-agent/synthesis/off-page-opportunity-builder.js";
import type {
  CompetitorAuthorityGap,
  ReferringDomainGrowthInsight,
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

describe("OffPageOpportunityBuilder", () => {
  const builder = new OffPageOpportunityBuilder();

  it("always includes a general link-building opportunity tied to the business objective", () => {
    const opportunities = builder.build(null, [], "Grow emergency plumbing leads.");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ category: "link-building", priority: "medium" });
    expect(opportunities[0]?.description).toContain("Grow emergency plumbing leads.");
  });

  it("surfaces a high-priority authority-gap opportunity when we are behind a competitor", () => {
    const opportunities = builder.build(null, [makeGap({ assessment: "we_are_behind" })], "x");
    const gapOpportunity = opportunities.find((o) => o.category === "authority-gap");
    expect(gapOpportunity).toMatchObject({ priority: "high" });
  });

  it("does not surface an authority-gap opportunity when we are ahead or comparable", () => {
    const opportunities = builder.build(
      null,
      [makeGap({ assessment: "we_are_ahead" }), makeGap({ competitorId: "b", assessment: "comparable" })],
      "x",
    );
    expect(opportunities.some((o) => o.category === "authority-gap")).toBe(false);
  });

  it("surfaces a high-priority opportunity for declining referring domains", () => {
    const declining: ReferringDomainGrowthInsight = { totalReferringDomains: 80, previousTotalReferringDomains: 100, trend: "declining" };
    const opportunities = builder.build(declining, [], "x");
    const declineOpportunity = opportunities.find((o) => o.category === "referring-domain-decline");
    expect(declineOpportunity).toMatchObject({ priority: "high" });
  });

  it("does not surface a referring-domain opportunity when growth is stable or growing", () => {
    const stable: ReferringDomainGrowthInsight = { totalReferringDomains: 100, previousTotalReferringDomains: 100, trend: "stable" };
    const opportunities = builder.build(stable, [], "x");
    expect(opportunities.some((o) => o.category === "referring-domain-decline")).toBe(false);
  });
});
