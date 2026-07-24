// Builds prioritized local SEO recommendations from real, already-computed
// reports only. A general, always-on citation-consistency recommendation
// is included since NAP consistency across external directories is a real,
// foundational local SEO practice regardless of data availability; every
// other recommendation traces to a real NAP discrepancy, a real review
// needing a response, or a real local-performance decline. Every
// recommendation that would touch the live listing or an external
// directory is marked `requiresApproval: true` -- this agent only ever
// prepares recommendations, never executes them.

import type {
  LocalPerformanceReport,
  LocalSeoRecommendation,
  NapConsistencyCheck,
  ReviewManagementReport,
} from "../types/google-business-profile-request.types.js";

export class LocalSeoRecommendationBuilder {
  build(
    businessName: string,
    websiteUrl: string,
    napConsistency: NapConsistencyCheck,
    reviewManagement: ReviewManagementReport,
    localPerformance: LocalPerformanceReport,
  ): LocalSeoRecommendation[] {
    const recommendations: LocalSeoRecommendation[] = [
      {
        category: "citation",
        priority: "medium",
        recommendation: `Ensure NAP consistency across major local directories and citation sources for ${businessName} at ${websiteUrl}.`,
        rationale: "Consistent NAP across citations is a foundational local SEO practice.",
        requiresApproval: true,
      },
    ];

    if (napConsistency.isConsistent === false) {
      recommendations.push({
        category: "nap",
        priority: "high",
        recommendation: `Correct the NAP discrepancies on the live listing: ${napConsistency.discrepancies.join("; ")}.`,
        rationale: "Real, observed mismatch between the caller's authoritative NAP and the live listing.",
        requiresApproval: true,
      });
    }

    for (const review of reviewManagement.reviewsNeedingResponse) {
      recommendations.push({
        category: "review",
        priority: review.priority,
        recommendation: `Respond to the ${review.sentiment} review (rating ${review.rating}, id ${review.reviewId}).`,
        rationale: "Real, provider-reported review with no owner response yet.",
        requiresApproval: true,
      });
    }

    if (localPerformance.trend === "declining") {
      recommendations.push({
        category: "performance",
        priority: "high",
        recommendation: "Investigate the decline in local search visibility (search views, map views).",
        rationale: `Real, measured local search views declined (currently ${localPerformance.searchViews}).`,
        requiresApproval: false,
      });
    }

    return recommendations;
  }
}
