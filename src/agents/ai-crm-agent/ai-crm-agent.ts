// AI CRM Agent, per Agents/ai-crm-agent.md.
//
// Workflow:
//   1. Validate the request: every supplied clientInfo entry must have a
//      non-empty clientName, status, and lastContactedAt.
//   2. Log "ai_crm_requested".
//   3. Build the lead pipeline, follow-up activities, and campaign
//      activity report from real, already-computed data only: the Reply &
//      Negotiation Agent's own negotiation status, the Outreach Agent's
//      own follow-up schedule, and the Campaign Tracking Agent's own
//      status. Build a client status report from real, caller-supplied
//      client information (activity computed from a real date comparison).
//   4. Propose CRM record updates for every real prospect touched by
//      outreach and every real, caller-supplied client -- always
//      "create"/"update", never "delete" (per this agent's own rule,
//      "never delete important records without approval", this build
//      never proposes one at all), and always marked `requiresApproval:
//      true` since writing to a real CRM tool is an external-system
//      update.
//   5. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from all three upstream results plus
//      this agent's own scope disclaimers.
//   6. Log "ai_crm_completed" and return.
//
// This agent has no ApprovalChannel, for the same reason as the Campaign
// Tracking Agent: it makes no approve/reject judgment call on uncertain
// evidence -- it only aggregates and proposes updates from data that is
// already real and already decided elsewhere. Each proposed update is
// itself marked `requiresApproval: true` for whoever executes it.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// client record, a prospect's CRM status, or a pipeline stage -- every
// field traces to a real, already-computed upstream result or real,
// caller-supplied client information. No external service (Google Sheets,
// Airtable, HubSpot CRM, Notion) is called anywhere in this module, and
// this agent never writes to a real CRM itself.

import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { AiCrmAgentConfig } from "./config/ai-crm-agent.config.js";
import { AiCrmRequestValidator } from "./validation/ai-crm-request-validator.js";
import { LeadPipelineBuilder } from "./crm/lead-pipeline-builder.js";
import { FollowUpActivityBuilder } from "./crm/follow-up-activity-builder.js";
import { ClientStatusReportBuilder } from "./crm/client-status-report-builder.js";
import { CampaignActivityReportBuilder } from "./crm/campaign-activity-report-builder.js";
import { CrmRecordUpdateBuilder } from "./crm/crm-record-update-builder.js";
import type { AiCrmRequest, AiCrmResult } from "./types/ai-crm-request.types.js";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Google Sheets, Airtable, HubSpot CRM, Notion, or any other external CRM tool -- it " +
  "only aggregates real, already-computed upstream results and real, caller-supplied client information, and " +
  "proposes record updates for a human to review and apply elsewhere.";

const NO_EXISTING_RECORD_SIGNAL_LIMITATION =
  "This agent cannot determine whether a prospect record already exists in a real CRM, since no CRM read " +
  "integration exists in this build; every prospect update is proposed as a new record, never an update.";

export class AiCrmAgent {
  constructor(
    private readonly validator: AiCrmRequestValidator,
    private readonly leadPipelineBuilder: LeadPipelineBuilder,
    private readonly followUpActivityBuilder: FollowUpActivityBuilder,
    private readonly clientStatusReportBuilder: ClientStatusReportBuilder,
    private readonly campaignActivityReportBuilder: CampaignActivityReportBuilder,
    private readonly crmRecordUpdateBuilder: CrmRecordUpdateBuilder,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(config: AiCrmAgentConfig): Promise<AiCrmAgent> {
    return new AiCrmAgent(
      new AiCrmRequestValidator(),
      new LeadPipelineBuilder(),
      new FollowUpActivityBuilder(),
      new ClientStatusReportBuilder(),
      new CampaignActivityReportBuilder(),
      new CrmRecordUpdateBuilder(),
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageCrm(request: AiCrmRequest): Promise<AiCrmResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "ai-crm-agent",
        eventType: "ai_crm_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "ai-crm-agent",
      eventType: "ai_crm_requested",
      details: { requestId: request.id, clientInfoCount: request.clientInfo?.length ?? 0 },
    });

    const clientInfo = request.clientInfo ?? [];
    const leadPipeline = this.leadPipelineBuilder.build(request.replyNegotiation);
    const followUpActivities = this.followUpActivityBuilder.build(request.outreach);
    const clientStatusReport = this.clientStatusReportBuilder.build(clientInfo);
    const campaignActivity = this.campaignActivityReportBuilder.build(request.campaignTracking);
    const crmRecordUpdates = this.crmRecordUpdateBuilder.build(request.outreach, request.replyNegotiation, clientInfo);

    const dataAvailable = request.outreach.dataAvailable || request.replyNegotiation.dataAvailable;

    const limitations: string[] = [
      ...request.outreach.limitations,
      ...request.campaignTracking.limitations,
      ...request.replyNegotiation.limitations,
      OUT_OF_SCOPE_LIMITATION,
      NO_EXISTING_RECORD_SIGNAL_LIMITATION,
    ];
    if (clientInfo.length === 0) {
      limitations.push("No client information was supplied; the client status report is empty.");
    }
    if (!dataAvailable) {
      limitations.push("No real outreach or negotiation activity was available; the lead pipeline reflects no real leads.");
    }

    const result: AiCrmResult = {
      requestId: request.id,
      dataAvailable,
      leadPipeline,
      followUpActivities,
      clientStatusReport,
      campaignActivity,
      crmRecordUpdates,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "ai-crm-agent",
      eventType: "ai_crm_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        leadCount: leadPipeline.length,
        crmRecordUpdateCount: crmRecordUpdates.length,
      },
    });

    return result;
  }
}
