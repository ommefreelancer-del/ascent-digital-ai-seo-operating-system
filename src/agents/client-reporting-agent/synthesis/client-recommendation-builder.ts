// Translates real, already-prioritized recommendations into client-facing
// language -- per the spec's "Recommend next-step priorities"
// responsibility. When a real SeoStrategyResult is available, its own
// quick-win quadrant (real impact/effort prioritization, already computed)
// is surfaced first, since those are the best-ROI items to show a client.
// Quick wins are presented at "high" priority here as a documented
// client-communication convention (they are the items worth acting on
// first), not a re-derivation of the Strategy Agent's own scoring. Without
// a SeoStrategyResult, this falls back to the real recommendations already
// computed by the Performance Analytics Agent.

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { SeoStrategyResult } from "../../seo-strategy-agent/types/seo-strategy-request.types.js";
import type { ClientRecommendation } from "../types/client-reporting-request.types.js";

export class ClientRecommendationBuilder {
  build(performanceAnalytics: PerformanceAnalyticsResult, seoStrategy: SeoStrategyResult | undefined): ClientRecommendation[] {
    if (seoStrategy) {
      return seoStrategy.prioritizationMatrix.quickWins.map((item) => ({
        priority: "high",
        recommendation: item.description,
        rationale: `Prioritized quick win from the SEO Strategy Agent's real roadmap: ${item.rationale}`,
      }));
    }

    return performanceAnalytics.recommendations.map((recommendation) => ({
      priority: recommendation.priority,
      recommendation: recommendation.recommendation,
      rationale: recommendation.rationale,
    }));
  }
}
