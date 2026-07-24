// Client Relationship Management Agent, per Agents/client-relationship-management-agent.md.
//
// Workflow:
//   1. Validate the request: every real, caller-supplied quotation,
//      contract, and invoice must have a non-empty clientName, and
//      quotations/invoices must not carry a negative amount.
//   2. Log "client_relationship_management_requested".
//   3. Build real client profiles (a direct passthrough of the AI CRM
//      Agent's own client status report), a real sales pipeline report
//      (reusing the Guest Posting & Digital PR Agent's own per-domain
//      negotiation status and confirmed placements), a real financial
//      summary (plain aggregation over real, caller-supplied quotations/
//      contracts/invoices), a real project coordination report (combining
//      the Guest Posting & Digital PR Agent's campaign performance with the
//      Google Sheets Integration Agent's sync state), and a final real
//      client relationship report.
//   4. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   5. Log "client_relationship_management_completed" and return.
//
// This agent has no ApprovalChannel: it never sends a quotation, signs a
// contract, or sends an invoice itself -- it only aggregates and reports on
// real, caller-supplied financial records and real, already-computed
// upstream results, per its own rule "shall never make business commitments
// independently." This matches the precedent set by the other pure-
// aggregation agents (AiCrmAgent, CampaignTrackingAgent,
// GuestPostingDigitalPrAgent).
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// client, a pipeline stage beyond what real evidence supports, a financial
// amount, or a project status. No external CRM, spreadsheet, or accounting
// tool is called anywhere in this module.

import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ClientRelationshipManagementAgentConfig } from "./config/client-relationship-management-agent.config.js";
import { ClientRelationshipManagementRequestValidator } from "./validation/client-relationship-management-request-validator.js";
import { ClientProfileBuilder } from "./synthesis/client-profile-builder.js";
import { SalesPipelineBuilder } from "./synthesis/sales-pipeline-builder.js";
import { FinancialSummaryBuilder } from "./synthesis/financial-summary-builder.js";
import { ProjectCoordinationReportBuilder } from "./synthesis/project-coordination-report-builder.js";
import { ClientRelationshipReportBuilder } from "./synthesis/client-relationship-report-builder.js";
import type {
  ClientRelationshipManagementRequest,
  ClientRelationshipManagementResult,
} from "./types/client-relationship-management-request.types.js";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real CRM, spreadsheet, or accounting tool, and never sends a quotation, signs a " +
  "contract, or sends an invoice itself -- it only aggregates the real, already-computed results of the AI CRM, " +
  "Business Development, Google Sheets Integration, and Guest Posting & Digital PR Agents, plus real, " +
  "caller-supplied financial records.";

export class ClientRelationshipManagementAgent {
  constructor(
    private readonly validator: ClientRelationshipManagementRequestValidator,
    private readonly clientProfileBuilder: ClientProfileBuilder,
    private readonly salesPipelineBuilder: SalesPipelineBuilder,
    private readonly financialSummaryBuilder: FinancialSummaryBuilder,
    private readonly projectCoordinationReportBuilder: ProjectCoordinationReportBuilder,
    private readonly clientRelationshipReportBuilder: ClientRelationshipReportBuilder,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(config: ClientRelationshipManagementAgentConfig): Promise<ClientRelationshipManagementAgent> {
    return new ClientRelationshipManagementAgent(
      new ClientRelationshipManagementRequestValidator(),
      new ClientProfileBuilder(),
      new SalesPipelineBuilder(),
      new FinancialSummaryBuilder(),
      new ProjectCoordinationReportBuilder(),
      new ClientRelationshipReportBuilder(),
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageClientRelationships(request: ClientRelationshipManagementRequest): Promise<ClientRelationshipManagementResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "client-relationship-management-agent",
        eventType: "client_relationship_management_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "client-relationship-management-agent",
      eventType: "client_relationship_management_requested",
      details: { requestId: request.id, clientCount: request.crmData.clientStatusReport.length },
    });

    const quotations = request.quotations ?? [];
    const contracts = request.contracts ?? [];
    const invoices = request.invoices ?? [];

    const clientProfiles = this.clientProfileBuilder.build(request.crmData.clientStatusReport);
    const salesPipelineReport = this.salesPipelineBuilder.build(
      request.guestPostingDigitalPr.publisherRecords,
      request.guestPostingDigitalPr.confirmedPlacements,
    );
    const financialSummary = this.financialSummaryBuilder.build(quotations, contracts, invoices);
    const projectCoordinationReport = this.projectCoordinationReportBuilder.build(request.guestPostingDigitalPr, request.googleSheets);
    const clientRelationshipReport = this.clientRelationshipReportBuilder.build(clientProfiles, salesPipelineReport, financialSummary);

    const dataAvailable =
      request.crmData.dataAvailable ||
      request.businessDevelopment.dataAvailable ||
      request.googleSheets.dataAvailable ||
      request.guestPostingDigitalPr.dataAvailable;

    const limitations: string[] = [
      ...request.crmData.limitations,
      ...request.businessDevelopment.limitations,
      ...request.googleSheets.limitations,
      ...request.guestPostingDigitalPr.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];
    if (quotations.length === 0) {
      limitations.push("No quotations were supplied; the financial summary reflects no real quoted amounts.");
    }
    if (contracts.length === 0) {
      limitations.push("No contracts were supplied; the financial summary reflects no real signed contracts.");
    }
    if (invoices.length === 0) {
      limitations.push("No invoices were supplied; the financial summary reflects no real outstanding or overdue invoices.");
    }

    const result: ClientRelationshipManagementResult = {
      requestId: request.id,
      dataAvailable,
      clientProfiles,
      salesPipelineReport,
      financialSummary,
      projectCoordinationReport,
      clientRelationshipReport,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "client-relationship-management-agent",
      eventType: "client_relationship_management_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        totalClients: clientRelationshipReport.totalClients,
        pipelineCount: clientRelationshipReport.pipelineCount,
        wonDealCount: clientRelationshipReport.wonDealCount,
      },
    });

    return result;
  }
}
