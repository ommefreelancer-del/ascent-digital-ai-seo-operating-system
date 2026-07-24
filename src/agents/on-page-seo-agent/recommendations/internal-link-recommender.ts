// Recommends internal-linking action only when the Website Audit Agent
// flagged an internal-links problem (none found, or placeholder hrefs).
// This agent does not know the site's other pages, so it recommends the
// linking *practice* tied to the target keyword rather than naming specific
// destination pages it cannot verify exist.

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";

export class OnPageInternalLinkRecommender implements OnPageRecommender {
  readonly category = "internal-links";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const findings = context.websiteAudit.findings.filter((f) => f.category === "internal-links");
    if (findings.length === 0) {
      return [];
    }

    return findings.map((finding) => ({
      category: "internal-links",
      priority: "medium" as const,
      recommendation:
        `Add internal links using descriptive anchor text related to "${context.targetKeyword}" to other ` +
        "relevant pages on the site, and replace any placeholder links with real destinations.",
      rationale: `Website audit flagged: ${finding.message}`,
    }));
  }
}
