// Campaign Tracking Agent, per Agents/campaign-tracking-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignName.
//   2. Log "campaign_tracking_requested".
//   3. Build campaign status, progress reports, and a performance summary
//      from real, already-computed data only: the Outreach Agent's own
//      result, and real, caller-supplied campaign update entries.
//   4. Compile the result with an explicit `dataAvailable` flag (mirroring
//      the Outreach Agent's own) and limitations carried forward from it
//      plus this agent's own scope disclaimers.
//   5. Log "campaign_tracking_completed" and return.
//
// This agent has no ApprovalChannel: unlike the other pipeline agents, it
// makes no approve/reject judgment call on any real, uncertain evidence --
// it only aggregates and reports data that is already real and already
// decided elsewhere. Adding an unused escalation path here would be
// scaffolding without a purpose.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// campaign status, progress update, or performance figure, and never
// claims a campaign is "completed" without a real signal to justify it
// (this build has no real publisher-response data source -- that requires
// the Reply & Negotiation Agent). No external service (a CRM, a campaign
// tracker) is called anywhere in this module.

import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { CampaignTrackingAgentConfig } from "./config/campaign-tracking-agent.config.js";
import { CampaignTrackingRequestValidator } from "./validation/campaign-tracking-request-validator.js";
import { CampaignStatusBuilder } from "./tracking/campaign-status-builder.js";
import { ProgressReportBuilder } from "./tracking/progress-report-builder.js";
import { PerformanceSummaryBuilder } from "./tracking/performance-summary-builder.js";
import type { CampaignTrackingRequest, CampaignTrackingResult } from "./types/campaign-tracking-request.types.js";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real CRM or campaign-tracking API -- it only aggregates the Outreach Agent's real " +
  "result and real, caller-supplied campaign updates. It cannot determine full campaign completion since this " +
  "build has no real publisher-response data source (that requires the Reply & Negotiation Agent).";

export class CampaignTrackingAgent {
  constructor(
    private readonly validator: CampaignTrackingRequestValidator,
    private readonly statusBuilder: CampaignStatusBuilder,
    private readonly progressReportBuilder: ProgressReportBuilder,
    private readonly performanceSummaryBuilder: PerformanceSummaryBuilder,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(config: CampaignTrackingAgentConfig): Promise<CampaignTrackingAgent> {
    return new CampaignTrackingAgent(
      new CampaignTrackingRequestValidator(),
      new CampaignStatusBuilder(),
      new ProgressReportBuilder(),
      new PerformanceSummaryBuilder(),
      new AuditLogger(config.auditLogPath),
    );
  }

  async trackCampaign(request: CampaignTrackingRequest): Promise<CampaignTrackingResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "campaign-tracking-agent",
        eventType: "campaign_tracking_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "campaign-tracking-agent",
      eventType: "campaign_tracking_requested",
      details: { requestId: request.id, campaignName: request.campaignName },
    });

    const campaignUpdates = request.campaignUpdates ?? [];
    const campaignStatus = this.statusBuilder.build(request.outreach);
    const progressReports = this.progressReportBuilder.build(campaignUpdates);
    const performanceSummary = this.performanceSummaryBuilder.build(campaignStatus, request.outreach.dataAvailable);

    const limitations: string[] = [...request.outreach.limitations, OUT_OF_SCOPE_LIMITATION];
    if (campaignUpdates.length === 0) {
      limitations.push("No campaign updates were supplied; progress reporting reflects outreach status only.");
    }

    const result: CampaignTrackingResult = {
      requestId: request.id,
      campaignName: request.campaignName,
      dataAvailable: request.outreach.dataAvailable,
      campaignStatus,
      progressReports,
      performanceSummary,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "campaign-tracking-agent",
      eventType: "campaign_tracking_completed",
      details: {
        requestId: request.id,
        phase: campaignStatus.phase,
        draftedCount: campaignStatus.draftedCount,
        skippedCount: campaignStatus.skippedCount,
      },
    });

    return result;
  }
}
