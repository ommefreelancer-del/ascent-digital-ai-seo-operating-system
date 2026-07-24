// Shared contract for a single technical-SEO recommendation producer. Each
// recommender consumes the real audit findings plus the cross-functional
// notes (for confirmation cross-referencing) and returns zero or more
// recommendations -- zero when nothing in that category needs attention.

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoRecommendation } from "../types/technical-seo-request.types.js";

export interface TechnicalSeoRecommendationContext {
  readonly websiteAudit: WebsiteAuditResult;
  readonly crossFunctionalNotes: readonly string[];
}

export interface TechnicalSeoRecommender {
  readonly category: string;
  recommend(context: TechnicalSeoRecommendationContext): TechnicalSeoRecommendation[];
}
