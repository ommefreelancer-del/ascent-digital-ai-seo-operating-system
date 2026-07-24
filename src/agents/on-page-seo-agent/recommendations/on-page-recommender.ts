// Shared contract for a single on-page recommendation producer. Each
// recommender consumes the same context (the real audit findings, the
// target keyword, and its real classified intent) and returns zero or more
// recommendations -- zero when nothing about that category needs attention.

import type { SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { OnPageRecommendation } from "../types/on-page-seo-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export interface OnPageRecommendationContext {
  readonly websiteAudit: WebsiteAuditResult;
  readonly targetKeyword: string;
  readonly intent: SearchIntent;
}

export interface OnPageRecommender {
  readonly category: string;
  recommend(context: OnPageRecommendationContext): OnPageRecommendation[];
}
