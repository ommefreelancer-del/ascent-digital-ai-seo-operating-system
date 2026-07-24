// Recommends adding a self-referencing canonical tag only when the Website
// Audit Agent flagged one as missing. Only actionable when the page's real
// URL is known (from websiteAudit.url); this agent never invents a URL.

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";

export class CanonicalRecommender implements OnPageRecommender {
  readonly category = "canonical";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const findings = context.websiteAudit.findings.filter((f) => f.category === "canonical");
    if (findings.length === 0) {
      return [];
    }

    const missing = findings.find((f) => f.message.toLowerCase().includes("no canonical"));
    if (!missing) {
      return [];
    }

    const recommendation = context.websiteAudit.url
      ? `Add a self-referencing canonical tag: <link rel="canonical" href="${context.websiteAudit.url}">.`
      : "Add a self-referencing canonical tag once the page's real URL is known.";

    return [
      {
        category: "canonical",
        priority: "medium",
        recommendation,
        rationale: `Website audit flagged: ${missing.message}`,
      },
    ];
  }
}
