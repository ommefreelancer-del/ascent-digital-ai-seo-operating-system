// Input/output shapes for the Campaign Tracking Agent, per
// Agents/campaign-tracking-agent.md. This agent introduces no new
// pluggable provider: it consumes the real, already-computed OutreachResult
// directly and real, caller-supplied campaign update entries -- it never
// fetches or infers anything itself. Per the spec's "Monitor responses"
// responsibility: this build has no real publisher-response data source
// (that requires the Reply & Negotiation Agent, not yet consumed here), so
// campaign phase is limited to what real outreach data can actually show
// ("not-started" or "in-progress") -- a fabricated "completed" state is
// never produced without a real signal to justify it.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";

/** A real, caller-supplied campaign update. Never invented. */
export interface CampaignUpdateEntry {
  readonly date: string;
  readonly description: string;
}

export interface CampaignTrackingRequest {
  readonly id: string;
  readonly campaignName: string;
  readonly outreach: OutreachResult;
  readonly campaignUpdates?: readonly CampaignUpdateEntry[];
}

/** "completed" is deliberately absent: this build has no real data source to justify that determination. */
export type CampaignPhase = "not-started" | "in-progress";

export interface CampaignStatusSummary {
  readonly phase: CampaignPhase;
  readonly totalApprovedPublishers: number;
  readonly draftedCount: number;
  readonly skippedCount: number;
}

export interface ProgressReportEntry {
  readonly date: string;
  readonly description: string;
}

export interface PerformanceSummary {
  /** Real ratio of drafted outreach to total approved publishers (0 when there are none). */
  readonly draftRate: number;
  /** Mirrors outreach.dataAvailable. */
  readonly outreachDataAvailable: boolean;
}

export interface CampaignTrackingResult {
  readonly requestId: string;
  readonly campaignName: string;
  /** Mirrors outreach.dataAvailable. */
  readonly dataAvailable: boolean;
  readonly campaignStatus: CampaignStatusSummary;
  readonly progressReports: readonly ProgressReportEntry[];
  readonly performanceSummary: PerformanceSummary;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
