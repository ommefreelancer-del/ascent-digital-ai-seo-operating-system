// Builds a ReferringDomainGrowthInsight from a real BacklinkProfile. Returns
// `null` when no profile was supplied -- never a fabricated domain count.

import type { BacklinkProfile } from "../types/backlink-data-provider.types.js";
import type { BacklinkTrend, ReferringDomainGrowthInsight } from "../types/off-page-seo-request.types.js";

function trendFor(totalReferringDomains: number, previousTotalReferringDomains: number | null): BacklinkTrend {
  if (previousTotalReferringDomains === null) {
    return "unknown";
  }
  if (totalReferringDomains > previousTotalReferringDomains) {
    return "growing";
  }
  if (totalReferringDomains < previousTotalReferringDomains) {
    return "declining";
  }
  return "stable";
}

export class ReferringDomainGrowthBuilder {
  build(profile: BacklinkProfile | null): ReferringDomainGrowthInsight | null {
    if (!profile) {
      return null;
    }
    return {
      totalReferringDomains: profile.totalReferringDomains,
      previousTotalReferringDomains: profile.previousTotalReferringDomains,
      trend: trendFor(profile.totalReferringDomains, profile.previousTotalReferringDomains),
    };
  }
}
