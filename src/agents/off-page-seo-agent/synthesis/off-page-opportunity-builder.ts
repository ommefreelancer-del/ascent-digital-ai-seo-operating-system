// Identifies off-page SEO opportunities -- per the spec's "identify
// high-quality backlink opportunities" and "identify local citation
// opportunities" responsibilities. One opportunity is always produced (a
// general, ethical link-building direction tied to the caller's real
// businessObjective) since relevance-driven outreach is a real, controllable
// lever regardless of backlink data availability; every other opportunity
// traces to a real, already-computed insight and this builder produces zero
// of those when no such insight exists.

import type {
  CompetitorAuthorityGap,
  OffPageOpportunity,
  ReferringDomainGrowthInsight,
} from "../types/off-page-seo-request.types.js";

export class OffPageOpportunityBuilder {
  build(
    referringDomainGrowth: ReferringDomainGrowthInsight | null,
    competitorAuthorityGaps: readonly CompetitorAuthorityGap[],
    businessObjective: string,
  ): OffPageOpportunity[] {
    const opportunities: OffPageOpportunity[] = [
      {
        category: "link-building",
        description:
          `Pursue ethical guest posting, resource-link, and local citation opportunities relevant to ` +
          `"${businessObjective}".`,
        rationale:
          "Relevance and topical authority are real, controllable link-building levers regardless of current " +
          "backlink data availability.",
        priority: "medium",
      },
    ];

    for (const gap of competitorAuthorityGaps) {
      if (gap.assessment === "we_are_behind") {
        opportunities.push({
          category: "authority-gap",
          description:
            `Competitor "${gap.competitorId}" has a higher domain authority (${gap.competitorDomainAuthority}) ` +
            `than ours (${gap.ourDomainAuthority}).`,
          rationale: "Both domain authority figures are real, measured values from the same backlink data provider.",
          priority: "high",
        });
      }
    }

    if (referringDomainGrowth && referringDomainGrowth.trend === "declining") {
      opportunities.push({
        category: "referring-domain-decline",
        description: `Referring domains declined to ${referringDomainGrowth.totalReferringDomains}.`,
        rationale: "A real, measured drop in referring domains between two measurement periods.",
        priority: "high",
      });
    }

    return opportunities;
  }
}
