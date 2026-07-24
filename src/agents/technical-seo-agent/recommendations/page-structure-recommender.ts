// Recommends fixes for basic page-structure findings (doctype, html lang,
// viewport meta) from the Website Audit Agent. Deliberately excludes the
// structured-data findings from the same "page-structure" audit category --
// those belong to the On-Page SEO Agent (StructuredDataRecommender), which
// owns content-relevant Schema.org markup. This keeps the two agents'
// ownership of "page-structure" findings non-overlapping.

import type { TechnicalSeoRecommendationContext, TechnicalSeoRecommender } from "./technical-seo-recommender.js";
import type { TechnicalSeoRecommendation } from "../types/technical-seo-request.types.js";
import { isConfirmedByCrossFunctionalNote } from "../util/cross-functional-match.js";
import { priorityFromSeverity } from "../util/priority-from-severity.js";

export class PageStructureRecommender implements TechnicalSeoRecommender {
  readonly category = "page-structure";

  recommend(context: TechnicalSeoRecommendationContext): TechnicalSeoRecommendation[] {
    return context.websiteAudit.findings
      .filter((finding) => finding.category === this.category)
      .filter((finding) => !finding.message.toLowerCase().includes("structured data"))
      .map((finding) => {
        const confirmed = isConfirmedByCrossFunctionalNote(finding, context.crossFunctionalNotes);
        return {
          category: this.category,
          priority: priorityFromSeverity(finding.severity),
          recommendation: finding.recommendation,
          rationale:
            `Website audit flagged: ${finding.message}` +
            (confirmed ? " Independently confirmed by the On-Page SEO Agent's cross-functional notes." : ""),
          confirmedByCrossFunctionalNote: confirmed,
        };
      });
  }
}
