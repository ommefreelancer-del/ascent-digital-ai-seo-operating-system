// Input/output shapes for the Reply & Negotiation Agent, per
// Agents/reply-negotiation-agent.md. This agent consumes the real,
// already-computed OutreachResult and CampaignTrackingResult directly --
// it only checks for replies from domains the Outreach Agent actually
// drafted outreach for (real evidence of contact), never a domain it
// invented. Quoted prices are extracted deterministically from real reply
// text (see negotiation/price-extractor.ts) -- never guessed when absent.
// Per this agent's own rule "never agree to pricing without user
// approval", an entry only ever appears in `finalAgreedPricing` after a
// human explicitly confirms it; declining does not fail the request, it
// simply leaves that domain's negotiation open.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";

/** Real, caller-supplied target pricing for this campaign. Never invented. */
export interface TargetPricing {
  readonly targetPrice: number;
  readonly maxAcceptablePrice: number;
  readonly currency: string;
}

export interface ReplyNegotiationRequest {
  readonly id: string;
  readonly outreach: OutreachResult;
  readonly campaignTracking: CampaignTrackingResult;
  readonly targetPricing: TargetPricing;
  /** Optional real, caller-supplied negotiation rules (e.g. "Never pay more than $150 for a dofollow link."). */
  readonly businessRules?: string;
  readonly userInstructions?: string;
  /** Optional real sender name for draft signatures. Uses a bracketed placeholder if omitted, never invented. */
  readonly senderName?: string;
}

export interface ConversationSummary {
  readonly domain: string;
  readonly replyCount: number;
  readonly latestReplyAt: string | null;
  readonly summary: string;
}

export type QuotedPriceStatus = "quoted" | "not-quoted";

export interface QuotedTerms {
  readonly domain: string;
  readonly status: QuotedPriceStatus;
  /** `null` when no real price could be extracted from the reply text -- never guessed. */
  readonly quotedPrice: number | null;
  /** The real text surrounding the extracted price, for traceability. `null` when no price was found. */
  readonly rawQuoteText: string | null;
}

export type NegotiationAssessment = "no-price-quoted" | "within-target" | "above-target-negotiable" | "above-max-reject";

export interface NegotiationRecommendation {
  readonly domain: string;
  readonly assessment: NegotiationAssessment;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface NegotiationReplyDraft {
  readonly domain: string;
  readonly subject: string;
  readonly body: string;
  /** Always true in this build: sending any message requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface FinalAgreedPrice {
  readonly domain: string;
  readonly agreedPrice: number;
  readonly currency: string;
  readonly confirmedAt: string;
}

export type NegotiationStatus =
  | "awaiting-reply"
  | "negotiating"
  | "agreed-pending-confirmation"
  | "agreed-confirmed"
  | "rejected-over-budget";

export interface NegotiationStatusEntry {
  readonly domain: string;
  readonly status: NegotiationStatus;
  readonly notes: string;
}

export interface ReplyNegotiationResult {
  readonly requestId: string;
  /** True only when a real PublisherReplyProvider snapshot was obtained for at least one domain. */
  readonly dataAvailable: boolean;
  readonly conversationSummaries: readonly ConversationSummary[];
  readonly quotedTerms: readonly QuotedTerms[];
  readonly negotiationRecommendations: readonly NegotiationRecommendation[];
  readonly replyDrafts: readonly NegotiationReplyDraft[];
  /** Only entries a human explicitly confirmed via the pricing_agreement escalation. */
  readonly finalAgreedPricing: readonly FinalAgreedPrice[];
  readonly negotiationStatusReport: readonly NegotiationStatusEntry[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
