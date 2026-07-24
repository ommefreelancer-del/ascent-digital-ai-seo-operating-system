// Input/output shapes for the Prospecting Agent, per
// Agents/prospecting-agent.md. This agent performs discovery only -- it
// never contacts a publisher and never negotiates (those are the Contact
// Intelligence, Outreach, and Reply & Negotiation Agents' jobs, later in
// the pipeline). Every prospect traces to a real candidate the
// ProspectDiscoveryProvider reported; category is the provider's own real
// classification, passed through unchanged, and confidence is a
// deterministic mapping from the provider's own real relevance score --
// never a fabricated judgment. With no provider configured (the default),
// `dataAvailable` is false and the prospect list is empty, never guessed.

export interface ProspectingRequest {
  readonly id: string;
  readonly campaignRequirements: string;
  readonly targetNiche: string;
  readonly targetCountry: string;
  readonly targetLanguage: string;
  readonly userInstructions?: string;
}

export type ProspectCategory = "guest-post" | "backlink" | "general";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface Prospect {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly category: ProspectCategory;
  readonly confidence: ConfidenceLevel;
  readonly notes: string;
}

export interface ProspectingResult {
  readonly requestId: string;
  /** False when no ProspectDiscoveryProvider supplied real data -- the prospect list is then empty, never guessed. */
  readonly dataAvailable: boolean;
  readonly prospects: readonly Prospect[];
  readonly duplicatesRemoved: number;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
