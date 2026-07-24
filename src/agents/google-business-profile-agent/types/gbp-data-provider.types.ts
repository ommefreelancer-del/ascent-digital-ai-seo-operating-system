// The seam between "the agent needs real Google Business Profile data" and
// "where that data actually comes from". GLOBAL_RULES.md SS2
// (Anti-Hallucination Policy) forbids fabricating NAP details, review
// content/ratings, or local search performance figures. No concrete
// provider backed by a real data source (Google Business Profile, Google
// Maps, BrightLocal, etc) ships in this build -- only the interface and a
// NullGbpDataProvider that honestly reports "unavailable" (see
// providers/null-gbp-data-provider.ts). A real provider can be plugged in
// later, once explicitly approved per GLOBAL_RULES.md SS9, without
// changing GoogleBusinessProfileAgent. This agent never publishes a Google
// Post or responds to a review itself, in this build or any future one --
// see google-business-profile-agent.ts.

export interface GbpDataRequest {
  readonly businessName: string;
  readonly websiteUrl: string;
}

/** Real, listed Name/Address/Phone as reported by the provider. */
export interface NapInfo {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
}

export interface GbpCategoryInfo {
  readonly primaryCategory: string;
  readonly secondaryCategories: readonly string[];
}

/** One real customer review, as reported by the provider. */
export interface CustomerReviewSnapshot {
  readonly reviewId: string;
  /** Real star rating, 1-5. */
  readonly rating: number;
  readonly text: string;
  readonly hasOwnerResponse: boolean;
  readonly postedAt: string;
}

/** Real, measured local search performance figures over the provider's own reporting window. */
export interface LocalSearchPerformance {
  readonly searchViews: number;
  readonly mapViews: number;
  readonly callClicks: number;
  readonly directionRequests: number;
  /** Search views as of the previous measurement period. `null` if no prior period is available. */
  readonly previousSearchViews: number | null;
}

export interface GbpSnapshot {
  readonly nap: NapInfo;
  readonly categoryInfo: GbpCategoryInfo;
  readonly reviews: readonly CustomerReviewSnapshot[];
  readonly localSearchPerformance: LocalSearchPerformance | null;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface GbpDataProvider {
  readonly name: string;
  /**
   * Resolves to the real GBP listing snapshot for the requested business, or
   * `null` if no data is available (no provider configured, listing not
   * found, etc). Implementations must never invent a value here -- `null`
   * is always the correct response when genuine data cannot be obtained.
   * Read-only: this method must never publish a post or respond to a review.
   */
  fetchGbpSnapshot(request: GbpDataRequest): Promise<GbpSnapshot | null>;
}
