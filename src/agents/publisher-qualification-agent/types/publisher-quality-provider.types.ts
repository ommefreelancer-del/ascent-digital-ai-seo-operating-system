// The seam between "the agent needs real publisher quality evidence" and
// "where that evidence actually comes from". This agent's own rules
// require it to "base decisions on available evidence" using only
// "approved SEO tools" and "public website data" -- GLOBAL_RULES.md SS9
// requires explicit human approval before "connecting external services".
// No concrete provider ships in this build -- only the interface and a
// NullPublisherQualityProvider that honestly reports "unavailable" (see
// providers/null-publisher-quality-provider.ts). Per this agent's own rule
// "forward only qualified prospects", a prospect with no real evidence
// behind it is rejected rather than assumed acceptable -- see
// qualification/prospect-qualifier.ts.

export interface PublisherQualityRequest {
  readonly domain: string;
  readonly url: string;
}

export interface PublisherQualitySnapshot {
  readonly domain: string;
  /** Real domain authority score (0-100), as reported by the provider. */
  readonly domainAuthority: number;
  /** Real spam score (0-100, higher is more spammy), as reported by the provider. */
  readonly spamScore: number;
  /** Real estimated monthly traffic, as reported by the provider. */
  readonly estimatedMonthlyTraffic: number;
  /** The provider's own real determination of niche relevance -- never inferred locally. */
  readonly isNicheRelevant: boolean;
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface PublisherQualityProvider {
  readonly name: string;
  /**
   * Resolves to real quality evidence for the requested publisher, or
   * `null` if no data is available (no provider configured, domain not
   * found, etc). Implementations must never invent a value here -- `null`
   * is always the correct response when genuine evidence cannot be
   * obtained. This agent evaluates only -- a provider must never contact
   * the publisher on the agent's behalf.
   */
  fetchPublisherQuality(request: PublisherQualityRequest): Promise<PublisherQualitySnapshot | null>;
}
