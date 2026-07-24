// Recommends adding descriptive alt text only when the Website Audit Agent
// flagged missing alt attributes. Explicitly warns against keyword
// stuffing the alt text, per this agent's own rule against manipulative
// tactics.

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";

export class ImageAltRecommender implements OnPageRecommender {
  readonly category = "image-alt";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const finding = context.websiteAudit.findings.find(
      (f) => f.category === "image-alt" && f.message.toLowerCase().includes("missing"),
    );
    if (!finding) {
      return [];
    }

    return [
      {
        category: "image-alt",
        priority: "medium",
        recommendation:
          `Add a descriptive alt attribute to each affected image. Where relevant to the image's actual ` +
          `content, naturally reference "${context.targetKeyword}" -- do not repeat it in every image's alt ` +
          "text, which would read as keyword stuffing.",
        rationale: `Website audit flagged: ${finding.message}`,
      },
    ];
  }
}
