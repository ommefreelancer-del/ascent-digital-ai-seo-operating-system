// Recommends fixes for real crawlability findings (noindex/nofollow meta
// directives). Only acts on the two actionable message patterns the
// Website Audit Agent's CrawlabilityChecker actually produces; the "no
// meta robots tag, no action required" case naturally does not match
// either and is correctly skipped.

import type { TechnicalSeoRecommendationContext, TechnicalSeoRecommender } from "./technical-seo-recommender.js";
import type { TechnicalSeoRecommendation } from "../types/technical-seo-request.types.js";
import { isConfirmedByCrossFunctionalNote } from "../util/cross-functional-match.js";
import { priorityFromSeverity } from "../util/priority-from-severity.js";

export class CrawlabilityRecommender implements TechnicalSeoRecommender {
  readonly category = "crawlability";

  recommend(context: TechnicalSeoRecommendationContext): TechnicalSeoRecommendation[] {
    return context.websiteAudit.findings
      .filter((finding) => finding.category === this.category)
      .filter((finding) => {
        const value = finding.message.toLowerCase();
        return value.includes("noindex") || value.includes("nofollow");
      })
      .map((finding) => {
        const confirmed = isConfirmedByCrossFunctionalNote(finding, context.crossFunctionalNotes);
        const recommendation = finding.message.toLowerCase().includes("noindex")
          ? "Remove the noindex directive from this page's <meta name=\"robots\"> tag if it should be " +
            "indexed, or confirm the exclusion is intentional (e.g. a staging or internal-only page)."
          : "Review the nofollow directive and confirm this page's outbound links should not be followed.";
        return {
          category: this.category,
          priority: priorityFromSeverity(finding.severity),
          recommendation,
          rationale:
            `Website audit flagged: ${finding.message}` +
            (confirmed ? " Independently confirmed by the On-Page SEO Agent's cross-functional notes." : ""),
          confirmedByCrossFunctionalNote: confirmed,
        };
      });
  }
}
