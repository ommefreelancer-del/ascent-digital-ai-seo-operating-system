// Guest Posting & Digital PR Agent, per Agents/guest-posting-digital-pr-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignName.
//   2. Log "guest_posting_digital_pr_requested".
//   3. Consolidate a real, domain-keyed publisher view from the real,
//      already-computed Prospecting, Publisher Qualification, Outreach, and
//      Reply & Negotiation results. Build a real campaign plan summary,
//      real confirmed placements (from the Reply & Negotiation Agent's own
//      human-confirmed pricing agreements), and a real campaign performance
//      report combining the Campaign Tracking Agent's own status with those
//      confirmed placements.
//   4. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   5. Log "guest_posting_digital_pr_completed" and return.
//
// This agent has no ApprovalChannel: it makes no approve/reject judgment
// call of its own -- discovery, qualification, outreach, negotiation, and
// pricing agreement are already decided by dedicated upstream agents. Its
// own value is consolidation and reporting, matching the precedent set by
// CampaignTrackingAgent/AiCrmAgent.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// publisher metric, outreach status, negotiation status, or placement, and
// never claims a live backlink was crawled (no real crawl data source
// exists in this build). No external service is called anywhere in this
// module.

import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { GuestPostingDigitalPrAgentConfig } from "./config/guest-posting-digital-pr-agent.config.js";
import { GuestPostingDigitalPrRequestValidator } from "./validation/guest-posting-digital-pr-request-validator.js";
import { PublisherRecordBuilder } from "./synthesis/publisher-record-builder.js";
import { CampaignPlanSummaryBuilder } from "./synthesis/campaign-plan-summary-builder.js";
import { ConfirmedPlacementBuilder } from "./synthesis/confirmed-placement-builder.js";
import { CampaignPerformanceReportBuilder } from "./synthesis/campaign-performance-report-builder.js";
import type { GuestPostingDigitalPrRequest, GuestPostingDigitalPrResult } from "./types/guest-posting-digital-pr-request.types.js";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real publisher database, SEO data tool, or crawler -- it only consolidates the real, " +
  "already-computed results of the Prospecting, Publisher Qualification, Outreach, Campaign Tracking, and Reply " +
  "& Negotiation Agents. Confirmed placements reflect only real, human-confirmed pricing agreements, never a " +
  "live crawl of the published page.";

export class GuestPostingDigitalPrAgent {
  constructor(
    private readonly validator: GuestPostingDigitalPrRequestValidator,
    private readonly publisherRecordBuilder: PublisherRecordBuilder,
    private readonly campaignPlanSummaryBuilder: CampaignPlanSummaryBuilder,
    private readonly confirmedPlacementBuilder: ConfirmedPlacementBuilder,
    private readonly campaignPerformanceReportBuilder: CampaignPerformanceReportBuilder,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(config: GuestPostingDigitalPrAgentConfig): Promise<GuestPostingDigitalPrAgent> {
    return new GuestPostingDigitalPrAgent(
      new GuestPostingDigitalPrRequestValidator(),
      new PublisherRecordBuilder(),
      new CampaignPlanSummaryBuilder(),
      new ConfirmedPlacementBuilder(),
      new CampaignPerformanceReportBuilder(),
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageGuestPostingDigitalPr(request: GuestPostingDigitalPrRequest): Promise<GuestPostingDigitalPrResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "guest-posting-digital-pr-agent",
        eventType: "guest_posting_digital_pr_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "guest-posting-digital-pr-agent",
      eventType: "guest_posting_digital_pr_requested",
      details: { requestId: request.id, campaignName: request.campaignName },
    });

    const publisherRecords = this.publisherRecordBuilder.build(
      request.prospecting.prospects,
      request.publisherQualification.approvedProspects,
      request.publisherQualification.rejectedProspects,
      request.outreach.outreachStatus,
      request.replyNegotiation.negotiationStatusReport,
    );
    const campaignPlanSummary = this.campaignPlanSummaryBuilder.build(
      request.prospecting.prospects,
      request.publisherQualification.approvedProspects,
      request.publisherQualification.rejectedProspects,
      request.outreach.outreachStatus,
      request.replyNegotiation.negotiationStatusReport,
    );
    const confirmedPlacements = this.confirmedPlacementBuilder.build(request.replyNegotiation.finalAgreedPricing);
    const campaignPerformanceReport = this.campaignPerformanceReportBuilder.build(
      request.campaignTracking,
      confirmedPlacements,
      request.prospecting.duplicatesRemoved,
    );

    const dataAvailable =
      request.prospecting.dataAvailable ||
      request.publisherQualification.dataAvailable ||
      request.outreach.dataAvailable ||
      request.replyNegotiation.dataAvailable;

    const limitations: string[] = [
      ...request.prospecting.limitations,
      ...request.publisherQualification.limitations,
      ...request.outreach.limitations,
      ...request.campaignTracking.limitations,
      ...request.replyNegotiation.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];
    if (!dataAvailable) {
      limitations.push("No real prospecting, qualification, outreach, or negotiation activity was available; publisher records reflect no real publishers.");
    }

    const result: GuestPostingDigitalPrResult = {
      requestId: request.id,
      dataAvailable,
      publisherRecords,
      campaignPlanSummary,
      confirmedPlacements,
      campaignPerformanceReport,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "guest-posting-digital-pr-agent",
      eventType: "guest_posting_digital_pr_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        publisherRecordCount: publisherRecords.length,
        confirmedPlacementCount: confirmedPlacements.length,
      },
    });

    return result;
  }
}
