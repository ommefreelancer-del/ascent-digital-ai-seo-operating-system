// Input/output shapes for the Contact Intelligence Agent, per
// Agents/contact-intelligence-agent.md. This agent uses only publicly
// available information -- it never sends an email or message (that is
// the Outreach Agent's job, later in the pipeline). Every contact record
// traces to a real candidate the ContactDiscoveryProvider reported; per
// this agent's own rule "forward verified records only", a record is only
// ever placed in `verifiedRecords` when the provider's own real
// verification flag confirms it -- an unverified or not-found contact is
// still surfaced (never silently dropped) but kept in `unverifiedRecords`,
// which the Outreach Agent should not treat as ready to use.

import type { PublisherQualificationResult } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactMethod } from "./contact-discovery-provider.types.js";

export interface ContactIntelligenceRequest {
  readonly id: string;
  readonly publisherQualification: PublisherQualificationResult;
  readonly campaignRequirements: string;
}

export interface ContactRecord {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  /** `null` when no real contact candidate was found for this domain. */
  readonly contactMethod: ContactMethod | null;
  /** `null` when no real contact candidate was found for this domain. Never a guessed value. */
  readonly contactValue: string | null;
  /** The real public page the contact was found on, if any. */
  readonly sourceUrl: string | null;
  readonly verificationNotes: string;
}

export interface ContactIntelligenceResult {
  readonly requestId: string;
  /** True only when a real ContactDiscoveryProvider snapshot was obtained for at least one publisher. */
  readonly dataAvailable: boolean;
  /** Real, provider-verified contact records -- the only records the Outreach Agent should act on. */
  readonly verifiedRecords: readonly ContactRecord[];
  /** Real candidates that could not be verified, or domains with no discoverable contact -- surfaced for transparency, never forwarded as ready-to-use. */
  readonly unverifiedRecords: readonly ContactRecord[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
