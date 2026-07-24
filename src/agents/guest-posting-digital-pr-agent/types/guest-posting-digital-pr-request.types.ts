// Input/output shapes for the Guest Posting & Digital PR Agent, per
// Agents/guest-posting-digital-pr-agent.md. This agent introduces no new
// pluggable provider and duplicates no existing agent's logic: it consumes
// the real, already-computed ProspectingResult, PublisherQualificationResult,
// OutreachResult, CampaignTrackingResult, and ReplyNegotiationResult
// directly -- discovery, qualification, outreach, tracking, and negotiation
// already have dedicated agents earlier in the pipeline. This agent's own
// value is consolidation: one real, domain-keyed publisher view, a campaign
// plan summary, confirmed placements, and a completion report -- never a
// re-derived judgment.

import type { Prospect, ProspectingResult } from "../../prospecting-agent/types/prospecting-request.types.js";
import type { PublisherQualificationResult, QualificationDecision } from "../../publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachResult, OutreachStatus } from "../../outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { NegotiationStatus, ReplyNegotiationResult } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";

export interface GuestPostingDigitalPrRequest {
  readonly id: string;
  readonly campaignName: string;
  readonly prospecting: ProspectingResult;
  readonly publisherQualification: PublisherQualificationResult;
  readonly outreach: OutreachResult;
  readonly campaignTracking: CampaignTrackingResult;
  readonly replyNegotiation: ReplyNegotiationResult;
}

export interface PublisherRecord {
  readonly domain: string;
  readonly title: string;
  readonly category: Prospect["category"];
  /** `null` when the Publisher Qualification Agent never evaluated this domain. */
  readonly qualification: QualificationDecision | null;
  /** `null` when the Outreach Agent never drafted outreach for this domain. */
  readonly outreachStatus: OutreachStatus | null;
  /** `null` when no real negotiation activity exists for this domain. */
  readonly negotiationStatus: NegotiationStatus | null;
  readonly notes: string;
}

export interface CampaignPlanSummary {
  readonly totalProspects: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly outreachDraftedCount: number;
  readonly activeNegotiationCount: number;
}

export interface ConfirmedPlacement {
  readonly domain: string;
  readonly agreedPrice: number;
  readonly currency: string;
  readonly confirmedAt: string;
}

export interface CampaignPerformanceReport {
  readonly campaignName: string;
  readonly phase: string;
  readonly draftedCount: number;
  readonly skippedCount: number;
  readonly confirmedPlacementCount: number;
  readonly duplicatesRemoved: number;
}

export interface GuestPostingDigitalPrResult {
  readonly requestId: string;
  /** True when real activity exists in any upstream stage of the pipeline. */
  readonly dataAvailable: boolean;
  readonly publisherRecords: readonly PublisherRecord[];
  readonly campaignPlanSummary: CampaignPlanSummary;
  readonly confirmedPlacements: readonly ConfirmedPlacement[];
  readonly campaignPerformanceReport: CampaignPerformanceReport;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
