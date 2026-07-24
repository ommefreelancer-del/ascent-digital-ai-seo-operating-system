// Website Management Agent, per Agents/website-management-agent.md.
//
// Workflow:
//   1. Validate the request: a non-empty url, and that websiteAudit/
//      technicalSeo (when known) agree on which page they describe -- a
//      genuine mismatch throws rather than being silently reconciled.
//   2. Log "website_management_requested".
//   3. If any caller-supplied update request or security alert contains a
//      destructive-action signal (restore, rollback, deletion, downgrade,
//      etc), escalate to a human before surfacing it as a maintenance
//      recommendation -- per this agent's own rule, "never make destructive
//      changes without approval."
//   4. Fetch real website health through the injected
//      WebsiteManagementProvider. With no provider configured (the
//      default), this always resolves to `null` -- uptime, pending
//      updates, backup status, and security scan results are never
//      fabricated to fill the gap.
//   5. Build the health/backup/security reports from whatever real data was
//      returned (empty/null/"unknown" when unavailable), then derive
//      prioritized maintenance recommendations from those real reports plus
//      real "https" recommendations relayed from the Technical SEO Agent
//      and the caller's own real update requests/security alerts. Every
//      recommendation that would touch the live site or an external system
//      is marked `requiresApproval: true` -- this agent only ever prepares
//      recommendations, never executes them, in this build or any future
//      one.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   7. Log "website_management_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents an
// uptime percentage, update version, backup date, or security scan result.
// No external service (WordPress, cPanel/hosting dashboard, Cloudflare,
// UpdraftPlus, Wordfence) is called anywhere in this module -- see
// providers/null-website-management-provider.ts. GLOBAL_RULES.md SS9: this
// agent never executes an update, backup, restore, or security action --
// it only prepares recommendations for a human to authorize and (once a
// real provider is approved and wired in) execute elsewhere.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { WebsiteManagementAgentConfig } from "./config/website-management-agent.config.js";
import { WebsiteManagementRequestValidator } from "./validation/website-management-request-validator.js";
import type { WebsiteManagementProvider } from "./types/website-management-provider.types.js";
import { NullWebsiteManagementProvider } from "./providers/null-website-management-provider.js";
import { WebsiteHealthReportBuilder } from "./reporting/website-health-report-builder.js";
import { BackupReportBuilder } from "./reporting/backup-report-builder.js";
import { SecurityStatusReportBuilder } from "./reporting/security-status-report-builder.js";
import { MaintenanceRecommendationBuilder } from "./reporting/maintenance-recommendation-builder.js";
import type { WebsiteManagementRequest, WebsiteManagementResult } from "./types/website-management-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls WordPress, cPanel/hosting dashboard, Cloudflare, UpdraftPlus, Wordfence, or any " +
  "other external website-management service -- health data comes only from the injected " +
  "WebsiteManagementProvider, and this agent never executes an update, backup, restore, or security action " +
  "itself; it only prepares recommendations for human authorization.";

export class WebsiteManagementAgent {
  constructor(
    private readonly validator: WebsiteManagementRequestValidator,
    private readonly dataProvider: WebsiteManagementProvider,
    private readonly healthReportBuilder: WebsiteHealthReportBuilder,
    private readonly backupReportBuilder: BackupReportBuilder,
    private readonly securityStatusReportBuilder: SecurityStatusReportBuilder,
    private readonly recommendationBuilder: MaintenanceRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullWebsiteManagementProvider
   * (no real data source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: WebsiteManagementAgentConfig,
    dataProvider: WebsiteManagementProvider = new NullWebsiteManagementProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<WebsiteManagementAgent> {
    return new WebsiteManagementAgent(
      new WebsiteManagementRequestValidator(),
      dataProvider,
      new WebsiteHealthReportBuilder(),
      new BackupReportBuilder(),
      new SecurityStatusReportBuilder(),
      new MaintenanceRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageWebsite(request: WebsiteManagementRequest): Promise<WebsiteManagementResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "website-management-agent",
        eventType: "website_management_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "website-management-agent",
      eventType: "website_management_requested",
      details: { requestId: request.id, url: request.url },
    });

    const destructiveActionSignals = this.validator.findDestructiveActionSignals(request);
    if (destructiveActionSignals.length > 0) {
      const approved = await this.escalateDestructiveAction(request, destructiveActionSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "website-management-agent",
          eventType: "website_management_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing destructive-action signals.",
            signals: destructiveActionSignals,
          },
        });
        throw new Error(
          "Website management request was rejected by human review due to destructive-action signals.",
        );
      }
    }

    const snapshot = await this.dataProvider.fetchWebsiteHealth({ url: request.url });

    const healthReport = this.healthReportBuilder.build(snapshot);
    const backupReport = this.backupReportBuilder.build(snapshot?.backupStatus ?? null);
    const securityStatusReport = this.securityStatusReportBuilder.build(snapshot?.securityScan ?? null);
    const maintenanceRecommendations = this.recommendationBuilder.build(
      snapshot,
      backupReport,
      securityStatusReport,
      request.technicalSeo,
      request.updateRequests ?? [],
      request.securityAlerts ?? [],
    );

    const dataAvailable = snapshot !== null;
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: WebsiteManagementResult = {
      requestId: request.id,
      url: request.url,
      dataAvailable,
      healthReport,
      backupReport,
      securityStatusReport,
      maintenanceRecommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "website-management-agent",
      eventType: "website_management_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        healthStatus: healthReport.status,
        recommendationCount: maintenanceRecommendations.length,
      },
    });

    return result;
  }

  private buildLimitations(request: WebsiteManagementRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [
      ...request.websiteAudit.limitations,
      ...request.technicalSeo.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!request.businessRequirements) {
      limitations.push("No business requirements were supplied; maintenance priorities reflect technical signals only.");
    }
    if (!dataAvailable) {
      limitations.push(
        `No website management provider is configured (using "${this.dataProvider.name}"); uptime, pending ` +
          "updates, backup status, and security scan results are all unavailable.",
      );
    }

    return limitations;
  }

  private async escalateDestructiveAction(
    request: WebsiteManagementRequest,
    signals: readonly string[],
  ): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "destructive_action",
      summary:
        `Website management request "${request.id}" has real update request(s) or security alert(s) ` +
        `containing destructive/irreversible signal(s): ${signals.join(", ")}. GLOBAL_RULES.md requires ` +
        "human approval before surfacing these as maintenance recommendations.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed and surface these as maintenance recommendations pending execution",
          score: 0,
          rationale:
            "Approving continues website management analysis and includes these items in the recommendations; " +
            "this agent still never executes them.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "website-management-agent",
      eventType: "website_management_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "website-management-agent",
      eventType: "website_management_escalation_resolved",
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
