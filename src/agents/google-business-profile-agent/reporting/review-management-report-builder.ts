// Builds a ReviewManagementReport from real, provider-reported reviews.
// Sentiment is a deterministic mapping from the review's own real star
// rating (documented convention: 4-5 positive, 3 neutral, 1-2 negative),
// not an invented judgment. Only reviews the provider reports as having no
// owner response yet are surfaced as needing one -- this agent never claims
// to have responded to anything itself.

import type { CustomerReviewSnapshot } from "../types/gbp-data-provider.types.js";
import type { ReviewManagementReport, ReviewPriority, ReviewSentiment } from "../types/google-business-profile-request.types.js";

function sentimentFor(rating: number): ReviewSentiment {
  if (rating >= 4) {
    return "positive";
  }
  if (rating === 3) {
    return "neutral";
  }
  return "negative";
}

function priorityFor(sentiment: ReviewSentiment): ReviewPriority {
  return sentiment === "negative" ? "high" : "medium";
}

export class ReviewManagementReportBuilder {
  build(reviews: readonly CustomerReviewSnapshot[]): ReviewManagementReport {
    if (reviews.length === 0) {
      return { totalReviews: 0, averageRating: null, reviewsNeedingResponse: [] };
    }

    const averageRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
    const reviewsNeedingResponse = reviews
      .filter((review) => !review.hasOwnerResponse)
      .map((review) => {
        const sentiment = sentimentFor(review.rating);
        return { reviewId: review.reviewId, rating: review.rating, sentiment, priority: priorityFor(sentiment) };
      });

    return { totalReviews: reviews.length, averageRating, reviewsNeedingResponse };
  }
}
