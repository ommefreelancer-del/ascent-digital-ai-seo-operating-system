// Client Reporting Agent, per Agents/client-reporting-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty clientName/reportingPeriodLabel, and
//      that performanceAnalytics/websiteAudit/technicalSeo (when known)
//      agree on which page they describe -- a genuine mismatch throws
//      rather than being silently reconciled.
//   2. Log "client_reporting_requested".
//   3. If no real, measured performance data is available, escalate to a
//      human before compiling a report built mostly from structural
//      findings -- sending a low-substance report to a client without
//      review is a real reputational risk.
//   4. Build the KPI dashboard, achievements/challenges, and
//      recommendations from real, already-computed upstream results only
//      (plus real, caller-supplied business KPIs). This agent never
//      derives or infers a log of completed SEO activities, since no
//      activity-completion tracking data is a declared input.
//   5. Compile the result with limitations carried forward from every
//      upstream result plus this agent's own scope disclaimers, always
//      including the standing "no completed-activity log" limitation.
//   6. Log "client_reporting_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// metric, trend, or completed-work claim -- every sentence in the report
// traces to a real, already-computed upstream result or to real,
// caller-supplied business KPIs. No external API is called and no LLM is
// used anywhere in this module.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { ClientReportingAgentConfig } from "./config/client-reporting-agent.config.js";
import { ClientReportingRequestValidator } from "./validation/client-reporting-request-validator.js";
import { KpiDashboardBuilder } from "./synthesis/kpi-dashboard-builder.js";
import { AchievementChallengeBuilder } from "./synthesis/achievement-challenge-builder.js";
import { ClientRecommendationBuilder } from "./synthesis/client-recommendation-builder.js";
import { ExecutiveSummaryBuilder } from "./synthesis/executive-summary-builder.js";
import type { ClientReportingRequest, ClientReportingResult } from "./types/client-reporting-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const NO_ACTIVITY_LOG_LIMITATION =
  "This report does not include a log of completed SEO activities, since no activity-completion tracking data " +
  "is supplied to this agent; it reflects current-state findings, recommendations, rankings, audit results, " +
  "and available metrics only.";

export class ClientReportingAgent {
  constructor(
    private readonly validator: ClientReportingRequestValidator,
    private readonly kpiDashboardBuilder: KpiDashboardBuilder,
    private readonly achievementChallengeBuilder: AchievementChallengeBuilder,
    private readonly clientRecommendationBuilder: ClientRecommendationBuilder,
    private readonly executiveSummaryBuilder: ExecutiveSummaryBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: ClientReportingAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<ClientReportingAgent> {
    return new ClientReportingAgent(
      new ClientReportingRequestValidator(),
      new KpiDashboardBuilder(),
      new AchievementChallengeBuilder(),
      new ClientRecommendationBuilder(),
      new ExecutiveSummaryBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async generateReport(request: ClientReportingRequest): Promise<ClientReportingResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "client-reporting-agent",
        eventType: "client_reporting_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "client-reporting-agent",
      eventType: "client_reporting_requested",
      details: { requestId: request.id, clientName: request.clientName, reportingPeriodLabel: request.reportingPeriodLabel },
    });

    if (this.validator.looksLowConfidence(request)) {
      const approved = await this.escalateLowConfidence(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "client-reporting-agent",
          eventType: "client_reporting_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed without any real, measured performance data.",
          },
        });
        throw new Error(
          "Client reporting request was rejected by human review because no real, measured performance " +
            "data was available.",
        );
      }
    }

    const businessKpis = request.businessKpis ?? [];
    const kpiDashboard = this.kpiDashboardBuilder.build(request.performanceAnalytics, businessKpis);
    const achievementsAndChallenges = this.achievementChallengeBuilder.build(
      request.performanceAnalytics,
      request.websiteAudit,
    );
    const recommendations = this.clientRecommendationBuilder.build(request.performanceAnalytics, request.seoStrategy);
    const executiveSummary = this.executiveSummaryBuilder.build(
      request.clientName,
      request.reportingPeriodLabel,
      request.performanceAnalytics,
      request.websiteAudit,
    );

    const limitations: string[] = [
      ...request.performanceAnalytics.limitations,
      ...request.websiteAudit.limitations,
      ...request.technicalSeo.limitations,
      ...(request.seoStrategy?.limitations ?? []),
      NO_ACTIVITY_LOG_LIMITATION,
    ];
    if (!request.seoStrategy) {
      limitations.push(
        "seoStrategy was not supplied; recommendations reflect Performance Analytics findings only, not the " +
          "full prioritized roadmap.",
      );
    }
    if (businessKpis.length === 0) {
      limitations.push("No business KPIs were supplied; the KPI dashboard reflects SEO metrics only.");
    }

    const result: ClientReportingResult = {
      requestId: request.id,
      clientName: request.clientName,
      reportingPeriodLabel: request.reportingPeriodLabel,
      executiveSummary,
      kpiDashboard,
      achievementsAndChallenges,
      recommendations,
      dataAvailable: request.performanceAnalytics.dataAvailable,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "client-reporting-agent",
      eventType: "client_reporting_completed",
      details: {
        requestId: request.id,
        dataAvailable: result.dataAvailable,
        kpiCount: kpiDashboard.length,
        recommendationCount: recommendations.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: ClientReportingRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Client reporting request "${request.id}" has no real, measured performance data (rankings, traffic, ` +
        "or Core Web Vitals), so the report would be based on structural findings alone. GLOBAL_RULES.md " +
        "requires human confirmation before this reaches a client.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with a report based on structural/technical findings only",
          score: 0,
          rationale: "Approving continues report generation using the available structural and technical results.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "client-reporting-agent",
      eventType: "client_reporting_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "client-reporting-agent",
      eventType: "client_reporting_escalation_resolved",
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
