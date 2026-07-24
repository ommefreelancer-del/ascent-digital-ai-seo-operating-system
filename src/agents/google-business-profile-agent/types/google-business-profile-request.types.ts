// Input/output shapes for the Google Business Profile Agent, per
// Agents/google-business-profile-agent.md. This agent never publishes a
// Google Post or responds to a customer review itself, in this build or any
// future one -- every output here is a report or a draft for a human to
// authorize (Google Posts are drafted, never published; review responses
// are flagged as needing a human reply, never generated and sent
// automatically). With no GbpDataProvider configured (the default),
// `dataAvailable` is false and every data-dependent field is empty/null,
// never guessed.

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { GbpCategoryInfo, NapInfo } from "./gbp-data-provider.types.js";

export interface GoogleBusinessProfileRequest {
  readonly id: string;
  readonly businessName: string;
  readonly websiteUrl: string;
  /** The caller's real, authoritative Name/Address/Phone -- checked against the live listing, never assumed correct. */
  readonly expectedNap: NapInfo;
  /** Optional free-text local SEO strategy context. Echoed into limitations if omitted, never invented. */
  readonly localSeoStrategy?: string;
  /** Optional: reflected in local-performance context if supplied, otherwise its absence is stated as a limitation. */
  readonly performanceAnalytics?: PerformanceAnalyticsResult;
}

export interface NapConsistencyCheck {
  /** `null` when no real listing data is available -- never guessed. */
  readonly isConsistent: boolean | null;
  readonly discrepancies: readonly string[];
}

export type ReviewSentiment = "positive" | "neutral" | "negative";
export type ReviewPriority = "high" | "medium" | "low";

export interface ReviewManagementItem {
  readonly reviewId: string;
  readonly rating: number;
  readonly sentiment: ReviewSentiment;
  readonly priority: ReviewPriority;
}

export interface ReviewManagementReport {
  readonly totalReviews: number;
  /** `null` when there are no real reviews to average. */
  readonly averageRating: number | null;
  /** Real reviews with no owner response yet -- never a claim this agent has responded. */
  readonly reviewsNeedingResponse: readonly ReviewManagementItem[];
}

/** "unknown" when there is no prior measurement to compare against -- never guessed. */
export type LocalPerformanceTrend = "improving" | "declining" | "stable" | "unknown";

export interface LocalPerformanceReport {
  readonly searchViews: number | null;
  readonly mapViews: number | null;
  readonly callClicks: number | null;
  readonly directionRequests: number | null;
  readonly trend: LocalPerformanceTrend;
}

export interface GooglePostSuggestion {
  readonly topic: string;
  /** A deterministic template with bracketed placeholders -- never a fabricated real offer or event. */
  readonly draftText: string;
  /** Always true: publishing a Google Post is an external write action requiring human approval. */
  readonly requiresApproval: boolean;
}

export type LocalSeoRecommendationCategory = "nap" | "review" | "performance" | "citation";
export type LocalSeoRecommendationPriority = "high" | "medium" | "low";

export interface LocalSeoRecommendation {
  readonly category: LocalSeoRecommendationCategory;
  readonly priority: LocalSeoRecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
  readonly requiresApproval: boolean;
}

export interface GoogleBusinessProfileResult {
  readonly requestId: string;
  /** False when no GbpDataProvider supplied real data -- data-dependent fields are then empty/null, never guessed. */
  readonly dataAvailable: boolean;
  readonly napConsistency: NapConsistencyCheck;
  /** Real, observed categories as reported by the provider -- surfaced for transparency, never a "should have" claim without a real benchmark. */
  readonly observedCategories: GbpCategoryInfo | null;
  readonly reviewManagement: ReviewManagementReport;
  readonly localPerformance: LocalPerformanceReport;
  readonly googlePostsPlan: readonly GooglePostSuggestion[];
  readonly recommendations: readonly LocalSeoRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
