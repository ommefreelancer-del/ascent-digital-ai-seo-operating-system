// Recommends off-page SEO priorities -- per the spec's "recommend outreach
// strategies" and "identify disavow opportunities where appropriate"
// responsibilities. A general, ethical outreach recommendation is always
// produced; every data-dependent recommendation traces to a real,
// already-computed insight. Toxic backlinks are surfaced only as a
// human-review prompt, never as an automatic disavow instruction --
// disavowing a legitimate link by mistake can itself harm the site's
// authority.

import type {
  CompetitorAuthorityGap,
  OffPageRecommendation,
  ReferringDomainGrowthInsight,
  ToxicBacklinkInsight,
} from "../types/off-page-seo-request.types.js";

export class OffPageRecommendationBuilder {
  build(
    referringDomainGrowth: ReferringDomainGrowthInsight | null,
    competitorAuthorityGaps: readonly CompetitorAuthorityGap[],
    toxicBacklinks: readonly ToxicBacklinkInsight[],
    businessObjective: string,
  ): OffPageRecommendation[] {
    const recommendations: OffPageRecommendation[] = [
      {
        category: "link-building",
        priority: "medium",
        recommendation:
          `Prioritize outreach to sites genuinely relevant to "${businessObjective}" (guest posts, resource ` +
          "pages, local citations) over volume-driven link acquisition.",
        rationale: "Search engine guidelines favor relevance and authority over link quantity.",
      },
    ];

    for (const gap of competitorAuthorityGaps) {
      if (gap.assessment === "we_are_behind") {
        recommendations.push({
          category: "authority-gap",
          priority: "high",
          recommendation:
            `Increase link-building investment to close the domain authority gap with competitor ` +
            `"${gap.competitorId}" (${gap.ourDomainAuthority} vs. ${gap.competitorDomainAuthority}).`,
          rationale: `Real, measured domain authority gap: ${gap.ourDomainAuthority} vs. ${gap.competitorDomainAuthority}.`,
        });
      }
    }

    if (referringDomainGrowth && referringDomainGrowth.trend === "declining") {
      recommendations.push({
        category: "referring-domain-decline",
        priority: "high",
        recommendation:
          "Investigate the referring-domain decline; check for lost placements, site migrations, or expired content.",
        rationale: `Real, measured referring domains: ${referringDomainGrowth.totalReferringDomains} (declining).`,
      });
    }

    if (toxicBacklinks.length > 0) {
      recommendations.push({
        category: "disavow-review",
        priority: "high",
        recommendation:
          `Have a human reviewer verify the ${toxicBacklinks.length} flagged referring domain(s) before ` +
          "submitting any disavow file -- disavowing a legitimate link by mistake can harm rankings.",
        rationale: "Toxicity flags come from the backlink data provider and must be human-verified before acting.",
      });
    }

    return recommendations;
  }
}
