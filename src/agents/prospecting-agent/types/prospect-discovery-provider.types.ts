// The seam between "the agent needs to find real websites" and "where that
// discovery actually comes from". This agent's own rules require it to
// "use only approved tools and public information" (approved search
// engines, approved SEO tools, public business directories) -- GLOBAL_RULES.md
// SS9 requires explicit human approval before "connecting external
// services". No concrete provider ships in this build -- only the
// interface and a NullProspectDiscoveryProvider that honestly reports
// "unavailable" (see providers/null-prospect-discovery-provider.ts). A real
// provider can be plugged in later, once explicitly approved, without
// changing ProspectingAgent.

export interface ProspectDiscoveryRequest {
  readonly campaignRequirements: string;
  readonly targetNiche: string;
  readonly targetCountry: string;
  readonly targetLanguage: string;
  readonly userInstructions?: string;
}

export type ProspectOpportunityType = "guest-post" | "backlink" | "general";

/** One real, discovered website candidate, as reported by the provider. Never invented locally. */
export interface RawProspectCandidate {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly snippet: string;
  /** Real, provider-classified opportunity type -- this agent never re-derives it. */
  readonly opportunityType: ProspectOpportunityType;
  /** Real relevance score (0-1) as reported by the provider. */
  readonly relevanceScore: number;
}

export interface ProspectDiscoverySnapshot {
  readonly candidates: readonly RawProspectCandidate[];
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface ProspectDiscoveryProvider {
  readonly name: string;
  /**
   * Resolves to real discovered candidates for the request, or `null` if no
   * data is available (no provider configured, discovery failed, etc).
   * Implementations must never invent a candidate here -- `null` is always
   * the correct response when genuine discovery cannot be performed. This
   * agent performs discovery only -- a provider must never contact a
   * publisher or negotiate on the agent's behalf.
   */
  discoverProspects(request: ProspectDiscoveryRequest): Promise<ProspectDiscoverySnapshot | null>;
}
