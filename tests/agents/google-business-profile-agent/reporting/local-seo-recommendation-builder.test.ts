import { describe, expect, it } from "vitest";
import { LocalSeoRecommendationBuilder } from "../../../../src/agents/google-business-profile-agent/reporting/local-seo-recommendation-builder.js";
import type {
  LocalPerformanceReport,
  NapConsistencyCheck,
  ReviewManagementReport,
} from "../../../../src/agents/google-business-profile-agent/types/google-business-profile-request.types.js";

const CONSISTENT_NAP: NapConsistencyCheck = { isConsistent: true, discrepancies: [] };
const INCONSISTENT_NAP: NapConsistencyCheck = { isConsistent: false, discrepancies: ['phone: expected "555-1234", listed "555-9999"'] };
const NO_REVIEWS: ReviewManagementReport = { totalReviews: 0, averageRating: null, reviewsNeedingResponse: [] };
const STABLE_PERFORMANCE: LocalPerformanceReport = { searchViews: 500, mapViews: 200, callClicks: 30, directionRequests: 20, trend: "stable" };
const DECLINING_PERFORMANCE: LocalPerformanceReport = { searchViews: 400, mapViews: 200, callClicks: 30, directionRequests: 20, trend: "declining" };

describe("LocalSeoRecommendationBuilder", () => {
  const builder = new LocalSeoRecommendationBuilder();

  it("always includes a general citation-consistency recommendation", () => {
    const recommendations = builder.build("Acme Plumbing", "https://oursite.com", CONSISTENT_NAP, NO_REVIEWS, STABLE_PERFORMANCE);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ category: "citation", priority: "medium", requiresApproval: true });
  });

  it("recommends correcting real NAP discrepancies at high priority", () => {
    const recommendations = builder.build("Acme Plumbing", "https://oursite.com", INCONSISTENT_NAP, NO_REVIEWS, STABLE_PERFORMANCE);
    const napRecommendation = recommendations.find((r) => r.category === "nap");
    expect(napRecommendation).toMatchObject({ priority: "high", requiresApproval: true });
    expect(napRecommendation?.recommendation).toContain("555-9999");
  });

  it("does not recommend a NAP fix when consistent or when data is unavailable", () => {
    const consistent = builder.build("Acme", "https://oursite.com", CONSISTENT_NAP, NO_REVIEWS, STABLE_PERFORMANCE);
    const unknown = builder.build("Acme", "https://oursite.com", { isConsistent: null, discrepancies: [] }, NO_REVIEWS, STABLE_PERFORMANCE);
    expect(consistent.some((r) => r.category === "nap")).toBe(false);
    expect(unknown.some((r) => r.category === "nap")).toBe(false);
  });

  it("recommends responding to each review needing a response, in priority order preserved", () => {
    const reviewManagement: ReviewManagementReport = {
      totalReviews: 2,
      averageRating: 3,
      reviewsNeedingResponse: [
        { reviewId: "r1", rating: 1, sentiment: "negative", priority: "high" },
        { reviewId: "r2", rating: 5, sentiment: "positive", priority: "medium" },
      ],
    };
    const recommendations = builder.build("Acme", "https://oursite.com", CONSISTENT_NAP, reviewManagement, STABLE_PERFORMANCE);
    const reviewRecommendations = recommendations.filter((r) => r.category === "review");
    expect(reviewRecommendations).toHaveLength(2);
    expect(reviewRecommendations[0]).toMatchObject({ priority: "high" });
    expect(reviewRecommendations[1]).toMatchObject({ priority: "medium" });
  });

  it("recommends investigating a real local performance decline, without requiring approval", () => {
    const recommendations = builder.build("Acme", "https://oursite.com", CONSISTENT_NAP, NO_REVIEWS, DECLINING_PERFORMANCE);
    const performanceRecommendation = recommendations.find((r) => r.category === "performance");
    expect(performanceRecommendation).toMatchObject({ priority: "high", requiresApproval: false });
  });
});
