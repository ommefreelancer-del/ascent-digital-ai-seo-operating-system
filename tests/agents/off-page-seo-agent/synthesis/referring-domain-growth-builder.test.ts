import { describe, expect, it } from "vitest";
import { ReferringDomainGrowthBuilder } from "../../../../src/agents/off-page-seo-agent/synthesis/referring-domain-growth-builder.js";
import type { BacklinkProfile } from "../../../../src/agents/off-page-seo-agent/types/backlink-data-provider.types.js";

function makeProfile(overrides: Partial<BacklinkProfile> = {}): BacklinkProfile {
  return {
    url: "https://oursite.com/plumbing",
    domainAuthority: 40,
    totalReferringDomains: 100,
    previousTotalReferringDomains: 100,
    referringDomains: [],
    source: "test-provider",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReferringDomainGrowthBuilder", () => {
  const builder = new ReferringDomainGrowthBuilder();

  it("returns null when no profile was supplied", () => {
    expect(builder.build(null)).toBeNull();
  });

  it("marks a higher referring-domain count than before as growing", () => {
    const insight = builder.build(makeProfile({ totalReferringDomains: 120, previousTotalReferringDomains: 100 }));
    expect(insight?.trend).toBe("growing");
  });

  it("marks a lower referring-domain count than before as declining", () => {
    const insight = builder.build(makeProfile({ totalReferringDomains: 80, previousTotalReferringDomains: 100 }));
    expect(insight?.trend).toBe("declining");
  });

  it("marks an unchanged referring-domain count as stable", () => {
    const insight = builder.build(makeProfile({ totalReferringDomains: 100, previousTotalReferringDomains: 100 }));
    expect(insight?.trend).toBe("stable");
  });

  it("marks trend unknown when there is no previous referring-domain count", () => {
    const insight = builder.build(makeProfile({ previousTotalReferringDomains: null }));
    expect(insight?.trend).toBe("unknown");
  });
});
