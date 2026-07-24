// Compares our real domain authority against each competitor's real domain
// authority (both from the same BacklinkDataProvider, fetched once per
// site). A competitor with no known url, or no backlink data available for
// either side, gets an "unknown" assessment rather than a guessed one.

import type { CompetitorOverallGap } from "../../competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { BacklinkProfile } from "../types/backlink-data-provider.types.js";
import type { AuthorityAssessment, CompetitorAuthorityGap } from "../types/off-page-seo-request.types.js";

function assessmentFor(ourDomainAuthority: number | null, competitorDomainAuthority: number | null): AuthorityAssessment {
  if (ourDomainAuthority === null || competitorDomainAuthority === null) {
    return "unknown";
  }
  if (ourDomainAuthority > competitorDomainAuthority) {
    return "we_are_ahead";
  }
  if (ourDomainAuthority < competitorDomainAuthority) {
    return "we_are_behind";
  }
  return "comparable";
}

export class AuthorityGapBuilder {
  build(
    ourProfile: BacklinkProfile | null,
    competitorGapAnalysis: readonly CompetitorOverallGap[],
    competitorProfiles: ReadonlyMap<string, BacklinkProfile | null>,
  ): CompetitorAuthorityGap[] {
    const ourDomainAuthority = ourProfile?.domainAuthority ?? null;

    return competitorGapAnalysis.map((gap) => {
      const competitorDomainAuthority = competitorProfiles.get(gap.competitorId)?.domainAuthority ?? null;
      return {
        competitorId: gap.competitorId,
        competitorUrl: gap.competitorUrl,
        ourDomainAuthority,
        competitorDomainAuthority,
        assessment: assessmentFor(ourDomainAuthority, competitorDomainAuthority),
      };
    });
  }
}
