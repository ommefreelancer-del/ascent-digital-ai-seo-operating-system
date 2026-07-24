// Translates each real, already-computed TechnicalSeoRecommendation into an
// implementation-ready development task -- this agent's own real value-add
// per its "Support Technical SEO implementation" responsibility (Technical
// SEO Agent says WHAT to fix; this agent says HOW to build it). Priority is
// passed through unchanged from the real upstream recommendation, never
// re-scored. Acceptance criteria are a documented, generic engineering
// convention (staging verification, no regressions), not a fabricated
// business-specific claim.

import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { DraftDevelopmentTask } from "../types/web-development-request.types.js";

const SEO_IMPLEMENTATION_CRITERIA: readonly string[] = [
  "Implementation matches the Technical SEO Agent's recommendation.",
  "Change is verified not to regress any existing passing Website Audit or Technical SEO check.",
  "Change is tested in a staging environment before deployment.",
];

export class SeoImplementationTaskBuilder {
  build(technicalSeo: TechnicalSeoResult): DraftDevelopmentTask[] {
    return technicalSeo.recommendations.map((recommendation) => ({
      category: "seo-implementation",
      priority: recommendation.priority,
      title: `Implement: ${recommendation.recommendation}`,
      description: recommendation.recommendation,
      rationale: `Relayed from the Technical SEO Agent's real, already-computed recommendation: ${recommendation.rationale}`,
      acceptanceCriteria: SEO_IMPLEMENTATION_CRITERIA,
    }));
  }
}
