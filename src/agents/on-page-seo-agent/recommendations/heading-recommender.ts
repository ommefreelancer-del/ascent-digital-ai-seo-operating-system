// Recommends a heading-structure fix only when the Website Audit Agent
// actually flagged one (missing/multiple h1, or a skipped level).

import type { OnPageRecommendationContext, OnPageRecommender } from "./on-page-recommender.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";
import { capitalize } from "../util/capitalize.js";

export class HeadingRecommender implements OnPageRecommender {
  readonly category = "headings";

  recommend(context: OnPageRecommendationContext): OnPageRecommendation[] {
    const findings = context.websiteAudit.findings.filter((f) => f.category === "headings");
    if (findings.length === 0) {
      return [];
    }

    const term = capitalize(context.targetKeyword);
    return findings.map((finding) => ({
      category: "headings",
      priority: finding.severity === "critical" ? ("high" as const) : ("medium" as const),
      recommendation:
        `Use a single <h1> that clearly includes the target keyword, e.g. "${term}", and keep each ` +
        "subsequent heading one level below its parent (no skipped levels).",
      rationale: `Website audit flagged: ${finding.message}`,
    }));
  }
}
