// Recommends fixes for real robots.txt findings (a Disallow rule blocking
// the audited URL, or a missing Sitemap reference). Only acts on the two
// actionable message patterns the Website Audit Agent's RobotsTxtChecker
// actually produces; "no robots.txt content was supplied" naturally does
// not match either and is correctly skipped (that gap is already stated as
// a limitation by the Website Audit Agent itself).

import type { TechnicalSeoRecommendationContext, TechnicalSeoRecommender } from "./technical-seo-recommender.js";
import type { TechnicalSeoRecommendation } from "../types/technical-seo-request.types.js";
import { isConfirmedByCrossFunctionalNote } from "../util/cross-functional-match.js";
import { priorityFromSeverity } from "../util/priority-from-severity.js";

export class RobotsTxtRecommender implements TechnicalSeoRecommender {
  readonly category = "robots-txt";

  recommend(context: TechnicalSeoRecommendationContext): TechnicalSeoRecommendation[] {
    return context.websiteAudit.findings
      .filter((finding) => finding.category === this.category)
      .filter((finding) => {
        const value = finding.message.toLowerCase();
        return value.includes("disallow") || value.includes("no sitemap");
      })
      .map((finding) => {
        const confirmed = isConfirmedByCrossFunctionalNote(finding, context.crossFunctionalNotes);
        const recommendation = finding.message.toLowerCase().includes("disallow")
          ? "Remove or narrow the Disallow rule blocking this URL's path in robots.txt if the page should be crawlable."
          : "Add a Sitemap: line to robots.txt referencing the site's real XML sitemap URL.";
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
