import { describe, expect, it } from "vitest";
import { ToxicBacklinkInsightBuilder } from "../../../../src/agents/off-page-seo-agent/synthesis/toxic-backlink-insight-builder.js";
import type { BacklinkProfile, ReferringDomainSnapshot } from "../../../../src/agents/off-page-seo-agent/types/backlink-data-provider.types.js";

function makeReferringDomain(overrides: Partial<ReferringDomainSnapshot> = {}): ReferringDomainSnapshot {
  return {
    domain: "example.com",
    linkingUrl: "https://example.com/page",
    anchorText: "plumbing services",
    linkType: "dofollow",
    domainAuthority: 50,
    isToxic: false,
    discoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProfile(referringDomains: ReferringDomainSnapshot[]): BacklinkProfile {
  return {
    url: "https://oursite.com/plumbing",
    domainAuthority: 40,
    totalReferringDomains: referringDomains.length,
    previousTotalReferringDomains: null,
    referringDomains,
    source: "test-provider",
    retrievedAt: new Date().toISOString(),
  };
}

describe("ToxicBacklinkInsightBuilder", () => {
  const builder = new ToxicBacklinkInsightBuilder();

  it("returns an empty array when no profile was supplied", () => {
    expect(builder.build(null)).toEqual([]);
  });

  it("returns an empty array when no referring domain is flagged toxic", () => {
    const profile = makeProfile([makeReferringDomain({ isToxic: false })]);
    expect(builder.build(profile)).toEqual([]);
  });

  it("surfaces only the referring domains the provider flagged as toxic", () => {
    const clean = makeReferringDomain({ domain: "clean.example", isToxic: false });
    const toxic = makeReferringDomain({ domain: "spammy.example", isToxic: true });
    const insights = builder.build(makeProfile([clean, toxic]));

    expect(insights).toHaveLength(1);
    expect(insights[0]).toEqual({
      domain: "spammy.example",
      linkingUrl: toxic.linkingUrl,
      anchorText: toxic.anchorText,
    });
  });
});
