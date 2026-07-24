// Admin Agent, per Agents/admin-agent.md.
//
// Workflow:
//   1. Validate the request: every real, caller-supplied internal document,
//      project update, and team request must have its required field
//      non-empty.
//   2. Log "admin_requested".
//   3. Scan for destructive-action signals (deletion, removal, purge, wipe)
//      across the real team requests and project update notes. If found,
//      escalate to a human via the same ApprovalChannel/AuditLogger
//      primitives every other agent here uses -- per this agent's own rule,
//      "never delete critical records without approval." Archiving a
//      completed project is NOT flagged: it is one of this agent's own
//      normal responsibilities.
//   4. Organize the real, caller-supplied internal documents, flag stale
//      SOPs for review, build a real project status report from the real,
//      caller-supplied project updates, consolidate real client/prospect/
//      business-opportunity data from the AI CRM Agent and Business
//      Development Agent into administrative records, and check real
//      compliance invariants over that same data.
//   5. Compile the result with an explicit `dataAvailable` flag (true when
//      either upstream result carries real activity) and limitations
//      carried forward from both plus this agent's own scope disclaimers.
//   6. Log "admin_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// document, a project status, a client/prospect record, or a compliance
// finding -- every field traces to real, caller-supplied administrative
// context or a real, already-computed upstream result. No external service
// (Notion, Google Drive, Google Docs, Google Sheets, Trello, ClickUp) is
// called anywhere in this module, and this agent never deletes or archives
// a record itself.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { AdminAgentConfig } from "./config/admin-agent.config.js";
import { AdminRequestValidator } from "./validation/admin-request-validator.js";
import { DocumentOrganizer } from "./organizing/document-organizer.js";
import { SopReviewFlagBuilder } from "./organizing/sop-review-flag-builder.js";
import { ProjectStatusReportBuilder } from "./organizing/project-status-report-builder.js";
import { AdministrativeRecordBuilder } from "./organizing/administrative-record-builder.js";
import { ComplianceChecklistBuilder } from "./organizing/compliance-checklist-builder.js";
import type { AdminRequest, AdminResult } from "./types/admin-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Notion, Google Drive, Google Docs, Google Sheets, Trello, ClickUp, or any other " +
  "external productivity tool, and never deletes or archives a record itself -- it only organizes real, " +
  "already-computed upstream data and real, caller-supplied administrative context.";

export class AdminAgent {
  constructor(
    private readonly validator: AdminRequestValidator,
    private readonly documentOrganizer: DocumentOrganizer,
    private readonly sopReviewFlagBuilder: SopReviewFlagBuilder,
    private readonly projectStatusReportBuilder: ProjectStatusReportBuilder,
    private readonly administrativeRecordBuilder: AdministrativeRecordBuilder,
    private readonly complianceChecklistBuilder: ComplianceChecklistBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: AdminAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<AdminAgent> {
    return new AdminAgent(
      new AdminRequestValidator(),
      new DocumentOrganizer(),
      new SopReviewFlagBuilder(),
      new ProjectStatusReportBuilder(),
      new AdministrativeRecordBuilder(),
      new ComplianceChecklistBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageAdmin(request: AdminRequest): Promise<AdminResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "admin-agent",
        eventType: "admin_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "admin-agent",
      eventType: "admin_requested",
      details: { requestId: request.id, documentCount: request.internalDocuments?.length ?? 0 },
    });

    const destructiveActionSignals = this.validator.findDestructiveActionSignals(request);
    if (destructiveActionSignals.length > 0) {
      const approved = await this.escalateDestructiveAction(request, destructiveActionSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "admin-agent",
          eventType: "admin_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing destructive-action signals.",
            signals: destructiveActionSignals,
          },
        });
        throw new Error("Admin request was rejected by human review due to destructive-action signals.");
      }
    }

    const internalDocuments = request.internalDocuments ?? [];
    const projectUpdates = request.projectUpdates ?? [];

    const organizedDocumentation = this.documentOrganizer.build(internalDocuments);
    const sopReviewFlags = this.sopReviewFlagBuilder.build(internalDocuments);
    const projectStatusReport = this.projectStatusReportBuilder.build(projectUpdates);
    const administrativeRecords = this.administrativeRecordBuilder.build(
      request.crmData.clientStatusReport,
      request.businessDevelopment.qualifiedLeadReport,
      request.businessDevelopment.growthOpportunities,
    );
    const complianceChecklist = this.complianceChecklistBuilder.build(
      request.crmData.crmRecordUpdates,
      request.businessDevelopment.clientProposals,
      request.businessRequirements ?? null,
    );

    const dataAvailable = request.crmData.dataAvailable || request.businessDevelopment.dataAvailable;
    const limitations: string[] = [
      ...request.crmData.limitations,
      ...request.businessDevelopment.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];
    if (internalDocuments.length === 0) {
      limitations.push("No internal documents were supplied; organized documentation and SOP review flags are empty.");
    }
    if (projectUpdates.length === 0) {
      limitations.push("No project updates were supplied; the project status report is empty.");
    }
    if (!request.teamRequests || request.teamRequests.length === 0) {
      limitations.push("No team requests were supplied.");
    }
    if (!dataAvailable) {
      limitations.push("No real CRM or business development activity was available; administrative records reflect no real clients, prospects, or opportunities.");
    }

    const result: AdminResult = {
      requestId: request.id,
      dataAvailable,
      organizedDocumentation,
      sopReviewFlags,
      projectStatusReport,
      administrativeRecords,
      complianceChecklist,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "admin-agent",
      eventType: "admin_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        recordCount: administrativeRecords.length,
        complianceUnmetCount: complianceChecklist.filter((item) => item.status === "unmet").length,
      },
    });

    return result;
  }

  private async escalateDestructiveAction(request: AdminRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "destructive_action",
      summary:
        `Admin request "${request.id}" has real team request(s) or project update note(s) containing ` +
        `destructive/irreversible signal(s): ${signals.join(", ")}. GLOBAL_RULES.md requires human approval ` +
        "before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this administrative review despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues administrative organization; this agent still never deletes a record itself.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "admin-agent",
      eventType: "admin_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "admin-agent",
      eventType: "admin_escalation_resolved",
      details: {
        requestId: request.id,
        approvalRequestId: approvalRequest.id,
        outcome: decision.outcome,
        notes: decision.notes,
      },
    });

    return decision.outcome === "candidate_selected" && decision.selectedCandidateId === PROCEED_CANDIDATE_ID;
  }
}
