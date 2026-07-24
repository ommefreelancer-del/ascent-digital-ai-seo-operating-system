// Google Sheets Integration Agent, per Agents/google-sheets-integration-agent.md.
//
// Workflow:
//   1. Validate the request: a non-empty spreadsheetId.
//   2. Log "google_sheets_integration_requested".
//   3. If the real, caller-supplied userInstructions contain a
//      destructive-action signal (overwrite, delete, remove, purge, wipe),
//      escalate to a human before proceeding -- per this agent's own rules,
//      "never overwrite existing data without validation" and "request
//      user approval before major updates or deletions."
//   4. Fetch the real, current state of the spreadsheet through the
//      injected GoogleSheetsProvider. With no provider configured (the
//      default), this always resolves to `null` -- which existing rows are
//      real is never fabricated to fill the gap.
//   5. Build sheet update proposals from real, already-computed data only:
//      the AI CRM Agent's client status and lead pipeline, the Reply &
//      Negotiation Agent's agreed pricing and negotiation status, the
//      Outreach Agent's outreach status, and the Campaign Tracking Agent's
//      campaign status. Build a CRM synchronization report by echoing the
//      AI CRM Agent's own real record-update proposals, a data validation
//      report by cross-checking negotiation status against agreed pricing,
//      duplicate-record flags from the real snapshot itself, and a
//      spreadsheet summary from the real proposals.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   7. Log "google_sheets_integration_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// client, publisher, price, status, or duplicate. No external service
// (Google Sheets API, Google Drive API, Google Apps Script) is called
// anywhere in this module -- see providers/null-google-sheets-provider.ts.
// GLOBAL_RULES.md SS9: this agent never writes to a real Google Sheet
// itself -- it only prepares update proposals for a human to authorize and
// apply elsewhere.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { GoogleSheetsIntegrationAgentConfig } from "./config/google-sheets-integration-agent.config.js";
import { GoogleSheetsIntegrationRequestValidator } from "./validation/google-sheets-integration-request-validator.js";
import type { GoogleSheetsProvider } from "./types/google-sheets-provider.types.js";
import { NullGoogleSheetsProvider } from "./providers/null-google-sheets-provider.js";
import { SheetUpdateProposalBuilder } from "./synthesis/sheet-update-proposal-builder.js";
import { CrmSyncReportBuilder } from "./synthesis/crm-sync-report-builder.js";
import { DataValidationReportBuilder } from "./synthesis/data-validation-report-builder.js";
import { DuplicateRecordFlagBuilder } from "./synthesis/duplicate-record-flag-builder.js";
import { SpreadsheetSummaryBuilder } from "./synthesis/spreadsheet-summary-builder.js";
import type { GoogleSheetsIntegrationRequest, GoogleSheetsIntegrationResult } from "./types/google-sheets-integration-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls the Google Sheets API, Google Drive API, or Google Apps Script itself, and never " +
  "writes to a real spreadsheet -- it only reads through the injected GoogleSheetsProvider and prepares update " +
  "proposals for a human to authorize and apply elsewhere.";

export class GoogleSheetsIntegrationAgent {
  constructor(
    private readonly validator: GoogleSheetsIntegrationRequestValidator,
    private readonly dataProvider: GoogleSheetsProvider,
    private readonly sheetUpdateProposalBuilder: SheetUpdateProposalBuilder,
    private readonly crmSyncReportBuilder: CrmSyncReportBuilder,
    private readonly dataValidationReportBuilder: DataValidationReportBuilder,
    private readonly duplicateRecordFlagBuilder: DuplicateRecordFlagBuilder,
    private readonly spreadsheetSummaryBuilder: SpreadsheetSummaryBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullGoogleSheetsProvider
   * (no real data source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: GoogleSheetsIntegrationAgentConfig,
    dataProvider: GoogleSheetsProvider = new NullGoogleSheetsProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<GoogleSheetsIntegrationAgent> {
    return new GoogleSheetsIntegrationAgent(
      new GoogleSheetsIntegrationRequestValidator(),
      dataProvider,
      new SheetUpdateProposalBuilder(),
      new CrmSyncReportBuilder(),
      new DataValidationReportBuilder(),
      new DuplicateRecordFlagBuilder(),
      new SpreadsheetSummaryBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async syncSheets(request: GoogleSheetsIntegrationRequest): Promise<GoogleSheetsIntegrationResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "google-sheets-integration-agent",
        eventType: "google_sheets_integration_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "google-sheets-integration-agent",
      eventType: "google_sheets_integration_requested",
      details: { requestId: request.id, spreadsheetId: request.spreadsheetId },
    });

    const destructiveActionSignals = this.validator.findDestructiveActionSignals(request);
    if (destructiveActionSignals.length > 0) {
      const approved = await this.escalateDestructiveAction(request, destructiveActionSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "google-sheets-integration-agent",
          eventType: "google_sheets_integration_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing destructive-action signals.",
            signals: destructiveActionSignals,
          },
        });
        throw new Error("Google Sheets integration request was rejected by human review due to destructive-action signals.");
      }
    }

    const snapshot = await this.dataProvider.fetchSheetSnapshot({ spreadsheetId: request.spreadsheetId });

    const sheetUpdateProposals = this.sheetUpdateProposalBuilder.build(
      request.crmData.clientStatusReport,
      request.crmData.leadPipeline,
      request.replyNegotiation.finalAgreedPricing,
      request.outreach.outreachStatus,
      request.replyNegotiation.negotiationStatusReport,
      request.campaignTracking,
      snapshot,
    );
    const crmSyncReport = this.crmSyncReportBuilder.build(request.crmData.crmRecordUpdates);
    const dataValidationReport = this.dataValidationReportBuilder.build(
      request.replyNegotiation.negotiationStatusReport,
      request.replyNegotiation.finalAgreedPricing,
    );
    const duplicateFlags = this.duplicateRecordFlagBuilder.build(snapshot);
    const spreadsheetSummary = this.spreadsheetSummaryBuilder.build(sheetUpdateProposals);

    const dataAvailable = snapshot !== null;
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: GoogleSheetsIntegrationResult = {
      requestId: request.id,
      dataAvailable,
      sheetUpdateProposals,
      crmSyncReport,
      dataValidationReport,
      duplicateFlags,
      spreadsheetSummary,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "google-sheets-integration-agent",
      eventType: "google_sheets_integration_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        proposalCount: sheetUpdateProposals.length,
        duplicateFlagCount: duplicateFlags.length,
      },
    });

    return result;
  }

  private buildLimitations(request: GoogleSheetsIntegrationRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [
      ...request.crmData.limitations,
      ...request.outreach.limitations,
      ...request.campaignTracking.limitations,
      ...request.replyNegotiation.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!dataAvailable) {
      limitations.push(
        `No Google Sheets provider is configured (using "${this.dataProvider.name}"); this agent cannot verify ` +
          "which client/publisher rows already exist (every proposal defaults to \"create\") or detect real " +
          "duplicate rows in the spreadsheet.",
      );
    }

    return limitations;
  }

  private async escalateDestructiveAction(
    request: GoogleSheetsIntegrationRequest,
    signals: readonly string[],
  ): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "destructive_action",
      summary:
        `Google Sheets integration request "${request.id}" has real user instructions containing ` +
        `destructive/irreversible signal(s): ${signals.join(", ")}. GLOBAL_RULES.md requires human approval ` +
        "before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this spreadsheet synchronization despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues spreadsheet analysis; this agent still never writes to the sheet itself.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "google-sheets-integration-agent",
      eventType: "google_sheets_integration_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "google-sheets-integration-agent",
      eventType: "google_sheets_integration_escalation_resolved",
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
