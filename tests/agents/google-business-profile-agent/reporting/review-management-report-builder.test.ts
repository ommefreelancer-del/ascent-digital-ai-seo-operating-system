import { describe, expect, it } from "vitest";
import { ReviewManagementReportBuilder } from "../../../../src/agents/google-business-profile-agent/reporting/review-management-report-builder.js";
import type { CustomerReviewSnapshot } from "../../../../src/agents/google-business-profile-agent/types/gbp-data-provider.types.js";

function makeReview(overrides: Partial<CustomerReviewSnapshot> = {}): CustomerReviewSnapshot {
  return {
    reviewId: "review-1",
    rating: 5,
    text: "Great service!",
    hasOwnerResponse: false,
    postedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReviewManagementReportBuilder", () => {
  const builder = new ReviewManagementReportBuilder();

  it("reports zero reviews and no average when there are no real reviews", () => {
    expect(builder.build([])).toEqual({ totalReviews: 0, averageRating: null, reviewsNeedingResponse: [] });
  });

  it("computes a real average rating across all reviews", () => {
    const report = builder.build([makeReview({ rating: 5 }), makeReview({ rating: 3, reviewId: "review-2" })]);
    expect(report.totalReviews).toBe(2);
    expect(report.averageRating).toBe(4);
  });

  it("excludes reviews that already have an owner response", () => {
    const report = builder.build([makeReview({ hasOwnerResponse: true })]);
    expect(report.reviewsNeedingResponse).toHaveLength(0);
  });

  it("classifies a low rating as negative with high priority", () => {
    const report = builder.build([makeReview({ rating: 1 })]);
    expect(report.reviewsNeedingResponse[0]).toMatchObject({ sentiment: "negative", priority: "high" });
  });

  it("classifies a mid rating as neutral with medium priority", () => {
    const report = builder.build([makeReview({ rating: 3 })]);
    expect(report.reviewsNeedingResponse[0]).toMatchObject({ sentiment: "neutral", priority: "medium" });
  });

  it("classifies a high rating as positive with medium priority", () => {
    const report = builder.build([makeReview({ rating: 5 })]);
    expect(report.reviewsNeedingResponse[0]).toMatchObject({ sentiment: "positive", priority: "medium" });
  });
});
