import { describe, expect, it } from "vitest";
import { AuthorityGapBuilder } from "../../../../src/agents/off-page-seo-agent/synthesis/authority-gap-builder.js";
import type { BacklinkProfile } from "../../../../src/agents/off-page-seo-agent/types/backlink-data-provider.types.js";
import type { CompetitorOverallGap } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeProfile(domainAuthority: number): BacklinkProfile {
  return {
    url: "https://example.com",
    domainAuthority,
    totalReferringDomains: 10,
    previousTotalReferringDomains: null,
    referringDomains: [],
    source: "test-provider",
    retrievedAt: new Date().toISOString(),
  };
}

function makeGap(overrides: Partial<CompetitorOverallGap> = {}): CompetitorOverallGap {
  return {
    competitorId: "competitor-a",
    competitorUrl: "https://competitor-a.com",
    ourTotalIssues: 1,
    competitorTotalIssues: 0,
    assessment: "we_are_behind",
    ...overrides,
  };
}

describe("AuthorityGapBuilder", () => {
  const builder = new AuthorityGapBuilder();

  it("assesses we_are_ahead when our domain authority is higher", () => {
    const [gap] = builder.build(makeProfile(60), [makeGap()], new Map([["competitor-a", makeProfile(40)]]));
    expect(gap).toMatchObject({ ourDomainAuthority: 60, competitorDomainAuthority: 40, assessment: "we_are_ahead" });
  });

  it("assesses we_are_behind when the competitor's domain authority is higher", () => {
    const [gap] = builder.build(makeProfile(30), [makeGap()], new Map([["competitor-a", makeProfile(50)]]));
    expect(gap?.assessment).toBe("we_are_behind");
  });

  it("assesses comparable when both domain authorities are equal", () => {
    const [gap] = builder.build(makeProfile(40), [makeGap()], new Map([["competitor-a", makeProfile(40)]]));
    expect(gap?.assessment).toBe("comparable");
  });

  it("assesses unknown when our own domain authority is unavailable", () => {
    const [gap] = builder.build(null, [makeGap()], new Map([["competitor-a", makeProfile(40)]]));
    expect(gap).toMatchObject({ ourDomainAuthority: null, assessment: "unknown" });
  });

  it("assesses unknown when the competitor's domain authority is unavailable", () => {
    const [gap] = builder.build(makeProfile(40), [makeGap()], new Map([["competitor-a", null]]));
    expect(gap).toMatchObject({ competitorDomainAuthority: null, assessment: "unknown" });
  });

  it("passes through the competitorId and competitorUrl from the gap analysis unchanged", () => {
    const [gap] = builder.build(null, [makeGap({ competitorId: "competitor-x", competitorUrl: null })], new Map());
    expect(gap).toMatchObject({ competitorId: "competitor-x", competitorUrl: null });
  });
});
