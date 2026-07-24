// Recommends an HTTPS migration only when the Website Audit Agent's
// TechnicalSeoChecker actually flagged the audited URL as using
// "http://". A migration checklist is included since changing a live,
// indexed page's protocol is a real technical change (redirects, canonical
// tags, internal links, sitemap) -- not something to gloss over as a
// one-line fix.

import type { TechnicalSeoRecommendationContext, TechnicalSeoRecommender } from "./technical-seo-recommender.js";
import type { TechnicalSeoRecommendation } from "../types/technical-seo-request.types.js";
import { isConfirmedByCrossFunctionalNote } from "../util/cross-functional-match.js";
import { priorityFromSeverity } from "../util/priority-from-severity.js";

export class HttpsRecommender implements TechnicalSeoRecommender {
  readonly category = "https";

  recommend(context: TechnicalSeoRecommendationContext): TechnicalSeoRecommendation[] {
    return context.websiteAudit.findings
      .filter((finding) => finding.category === "technical-seo" && finding.message.includes("http://"))
      .map((finding) => {
        const confirmed = isConfirmedByCrossFunctionalNote(finding, context.crossFunctionalNotes);
        return {
          category: this.category,
          priority: priorityFromSeverity(finding.severity),
          recommendation:
            "Migrate this page to HTTPS: obtain/renew a valid TLS certificate, add a 301 redirect from the " +
            "http:// URL to the https:// URL, update the canonical tag and internal links to the https:// " +
            "version, and resubmit the sitemap once migrated.",
          rationale:
            `Website audit flagged: ${finding.message}` +
            (confirmed ? " Independently confirmed by the On-Page SEO Agent's cross-functional notes." : ""),
          confirmedByCrossFunctionalNote: confirmed,
        };
      });
  }
}
