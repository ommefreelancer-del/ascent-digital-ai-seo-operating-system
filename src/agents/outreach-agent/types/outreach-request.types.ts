// Input/output shapes for the Outreach Agent, per Agents/outreach-agent.md.
// This agent introduces no new pluggable provider: "Agency templates" is
// explicitly one of its own listed Tools, so drafting is a deterministic
// template over real, already-verified data -- the real publisher title,
// domain, real verified contact method/value from the Contact Intelligence
// Agent, and the real caller-supplied campaign requirements text. This
// agent never sends anything itself, per its own rule "do not send
// messages without human approval"; every draft is marked
// `requiresApproval: true`.
//
// A qualified (approved) publisher is only drafted for when a real,
// verified contact record exists for the same domain -- this agent never
// invents a contact method or value, and never guesses at an unverified
// one. A publisher with no verified contact is surfaced as skipped, never
// silently dropped.

import type { PublisherQualificationResult } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactIntelligenceResult } from "../../contact-intelligence-agent/types/contact-intelligence-request.types.js";
import type { ContactMethod } from "../../contact-intelligence-agent/types/contact-discovery-provider.types.js";

export interface OutreachRequest {
  readonly id: string;
  readonly publisherQualification: PublisherQualificationResult;
  readonly contactIntelligence: ContactIntelligenceResult;
  readonly campaignRequirements: string;
  /** Optional real sender name for the draft signature. Uses a bracketed placeholder if omitted, never invented. */
  readonly senderName?: string;
}

export interface OutreachDraft {
  readonly domain: string;
  readonly url: string;
  readonly title: string;
  readonly contactMethod: ContactMethod;
  readonly contactValue: string;
  readonly subject: string;
  readonly body: string;
  /** Always true in this build: sending any message requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface FollowUpScheduleEntry {
  readonly domain: string;
  readonly sequenceNumber: number;
  readonly scheduledDate: string;
  readonly messageDraft: string;
  readonly requiresApproval: boolean;
}

export type OutreachStatus = "drafted" | "skipped-no-verified-contact";

export interface OutreachStatusEntry {
  readonly domain: string;
  readonly status: OutreachStatus;
  readonly notes: string;
}

export interface SkippedPublisher {
  readonly domain: string;
  readonly url: string;
  readonly title: string;
  readonly reason: string;
}

export interface OutreachResult {
  readonly requestId: string;
  /** Mirrors contactIntelligence.dataAvailable -- false means no real verified contact data was available at all. */
  readonly dataAvailable: boolean;
  readonly outreachDrafts: readonly OutreachDraft[];
  readonly followUpSchedule: readonly FollowUpScheduleEntry[];
  readonly outreachStatus: readonly OutreachStatusEntry[];
  readonly skippedPublishers: readonly SkippedPublisher[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
