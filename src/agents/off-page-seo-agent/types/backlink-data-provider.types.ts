// The seam between "the agent needs real backlink data" and "where that
// data actually comes from". GLOBAL_RULES.md SS2 (Anti-Hallucination Policy)
// forbids fabricating domain authority, referring-domain counts, or
// toxicity flags. No concrete provider backed by a real data source (Ahrefs,
// SEMrush, Majestic, Moz) ships in this build -- only the interface and a
// NullBacklinkDataProvider that honestly reports "unavailable" (see
// providers/null-backlink-data-provider.ts). A real provider can be plugged
// in later, once explicitly approved per GLOBAL_RULES.md SS9, without
// changing OffPageSeoAgent.

export interface BacklinkMetricsRequest {
  readonly url: string;
}

export type LinkType = "dofollow" | "nofollow";

/** One real, measured referring domain, as reported by the provider. Never inferred locally. */
export interface ReferringDomainSnapshot {
  readonly domain: string;
  readonly linkingUrl: string;
  readonly anchorText: string;
  readonly linkType: LinkType;
  /** Real authority score (0-100), e.g. Domain Authority/Domain Rating, as reported by the provider. */
  readonly domainAuthority: number;
  /** Whether the provider's own toxicity analysis flags this referring domain. Never inferred locally. */
  readonly isToxic: boolean;
  readonly discoveredAt: string;
}

export interface BacklinkProfile {
  readonly url: string;
  /** The audited site's own real authority score (0-100), as reported by the provider. */
  readonly domainAuthority: number;
  readonly totalReferringDomains: number;
  /** Referring-domain count as of the previous measurement. `null` if no prior measurement exists. */
  readonly previousTotalReferringDomains: number | null;
  readonly referringDomains: readonly ReferringDomainSnapshot[];
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface BacklinkDataProvider {
  readonly name: string;
  /**
   * Resolves to the real backlink profile for `request.url`, or `null` if no
   * data is available (no provider configured, url not found in the data
   * source, etc). Implementations must never invent a value here -- `null`
   * is always the correct response when genuine data cannot be obtained.
   */
  fetchBacklinkProfile(request: BacklinkMetricsRequest): Promise<BacklinkProfile | null>;
}
