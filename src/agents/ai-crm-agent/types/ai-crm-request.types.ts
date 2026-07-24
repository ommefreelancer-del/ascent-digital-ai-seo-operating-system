// Input/output shapes for the AI CRM Agent, per Agents/ai-crm-agent.md.
// This agent introduces no new pluggable provider: it consumes the real,
// already-computed OutreachResult, CampaignTrackingResult, and
// ReplyNegotiationResult directly, plus real, caller-supplied client
// information -- it never fetches or infers anything itself. Per this
// agent's own rule "never delete important records without approval",
// this build never proposes a deletion at all; `crmRecordUpdates` is
// limited to "create"/"update" proposals, each marked `requiresApproval:
// true` since writing to a real CRM tool is an external-system update
// (GLOBAL_RULES.md SS9). This agent never writes to a real CRM itself, in
// this build or any future one -- it only reports real current state and
// proposes updates for a human to authorize.

import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult, CampaignPhase } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult, NegotiationStatus } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";

/** Real, caller-supplied information about an existing client. Never invented. */
export interface ClientInfoEntry {
  readonly clientName: string;
  readonly status: string;
  readonly lastContactedAt: string;
}

export interface AiCrmRequest {
  readonly id: string;
  readonly outreach: OutreachResult;
  readonly campaignTracking: CampaignTrackingResult;
  readonly replyNegotiation: ReplyNegotiationResult;
  readonly clientInfo?: readonly ClientInfoEntry[];
  readonly businessRequirements?: string;
}

export interface LeadPipelineEntry {
  readonly domain: string;
  /** Reuses the Reply & Negotiation Agent's own real negotiation status -- never re-derived. */
  readonly stage: NegotiationStatus;
  readonly notes: string;
}

export interface FollowUpActivity {
  readonly domain: string;
  readonly scheduledDate: string;
  readonly description: string;
}

/** "not-started"/"in-progress" here is >90 real days since last contact -- see crm/client-status-report-builder.ts. */
export type ClientActivityStatus = "active" | "inactive";

export interface ClientStatusEntry {
  readonly clientName: string;
  readonly status: string;
  readonly activity: ClientActivityStatus;
  readonly lastContactedAt: string;
}

export interface CampaignActivityEntry {
  readonly campaignName: string;
  /** Reuses the Campaign Tracking Agent's own real phase -- never re-derived. */
  readonly phase: CampaignPhase;
  readonly draftedCount: number;
  readonly skippedCount: number;
}

export type CrmRecordType = "prospect" | "client";
export type CrmRecordAction = "create" | "update";

export interface CrmRecordUpdate {
  readonly recordType: CrmRecordType;
  readonly action: CrmRecordAction;
  readonly identifier: string;
  readonly summary: string;
  /** Always true in this build: writing to a real CRM tool requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface AiCrmResult {
  readonly requestId: string;
  /** True when real outreach or negotiation activity exists to report on. */
  readonly dataAvailable: boolean;
  readonly leadPipeline: readonly LeadPipelineEntry[];
  readonly followUpActivities: readonly FollowUpActivity[];
  readonly clientStatusReport: readonly ClientStatusEntry[];
  readonly campaignActivity: CampaignActivityEntry;
  readonly crmRecordUpdates: readonly CrmRecordUpdate[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
