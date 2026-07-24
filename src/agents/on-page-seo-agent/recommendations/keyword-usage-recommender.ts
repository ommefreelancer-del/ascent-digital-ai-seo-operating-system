// Always-on, prescriptive guidance about where the target keyword should
// appear (URL, title, H1, opening content, image alt) -- grouped in one
// recommender since both concerns share the same trigger (always evaluated
// against the target keyword) rather than a specific audit finding.
//
// This agent does not have the page's actual body text (only the Website
// Audit Agent's findings, not its raw extracted facts), so it cannot verify
// whether the keyword already appears in the content -- it recommends
// where it *should* go rather than claiming to confirm where it currently
// is or isn't. That limitation is stated explicitly by the facade, not
// hidden here.

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class KeywordUsageRecommender implements OnPageRecommender {
  readonly category = "keyword-usage";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const recommendations: OnPageRecommendation[] = [];
    const slug = slugify(context.targetKeyword);

    if (context.websiteAudit.url) {
      let path: string | null = null;
      try {
        path = new URL(context.websiteAudit.url).pathname.toLowerCase();
      } catch {
        path = null;
      }
      const significantTokens = slug.split("-").filter((token) => token.length >= 3);
      const urlContainsKeyword =
        path !== null && significantTokens.length > 0 && significantTokens.some((token) => path!.includes(token));

      if (!urlContainsKeyword) {
        recommendations.push({
          category: "url-structure",
          priority: "low",
          recommendation:
            `Consider a URL that reflects the target keyword (e.g. a path containing "${slug}"). If the ` +
            "page is already live and indexed, add a 301 redirect from the old URL rather than changing it outright.",
          rationale: `The audited URL's path does not appear to contain "${context.targetKeyword}".`,
        });
      }
    }

    recommendations.push({
      category: "keyword-placement",
      priority: "low",
      recommendation:
        `Ensure "${context.targetKeyword}" appears naturally in the <title>, the <h1>, and the opening ` +
        "paragraph, plus in at least one image alt attribute where relevant -- without repeating it " +
        "unnaturally elsewhere on the page.",
      rationale:
        "This is prescriptive guidance, not a verified check: the current page body content was not " +
        "supplied to this agent, so actual keyword placement could not be confirmed.",
    });

    return recommendations;
  }
}
