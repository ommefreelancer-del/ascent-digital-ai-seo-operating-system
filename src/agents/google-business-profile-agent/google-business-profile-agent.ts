// Google Business Profile Agent, per Agents/google-business-profile-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty businessName/websiteUrl/expectedNap.
//   2. Log "gbp_requested".
//   3. Scan for Google Business Profile policy-risk signals (fake/
//      incentivized reviews, keyword-stuffed business name, fake/virtual
//      office address). If found, escalate to a human via the same
//      ApprovalChannel/AuditLogger primitives every other agent here uses.
//   4. Fetch a real GBP snapshot through the injected GbpDataProvider. With
//      no provider configured (the default), this always resolves to
//      `null` -- NAP, categories, reviews, and local search performance are
//      never fabricated to fill the gap.
//   5. Build the NAP consistency check (against the caller's real,
//      authoritative NAP), review management report, and local performance
//      report from whatever real data was returned (null/"unknown" when
//      unavailable), then draft Google Post ideas and prioritized local SEO
//      recommendations from those real reports. Every recommendation/post
//      that would touch the live listing or an external directory is
//      marked `requiresApproval: true` -- this agent never publishes a post
//      or responds to a review itself, in this build or any future one.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from the optional PerformanceAnalyticsResult
//      plus this agent's own scope disclaimers.
//   7. Log "gbp_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a NAP
// detail, review, rating, or local search performance figure. No external
// service (Google Business Profile, Google Maps, Google Search Console,
// Google Analytics 4, BrightLocal) is called anywhere in this module -- see
// providers/null-gbp-data-provider.ts.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { GoogleBusinessProfileAgentConfig } from "./config/google-business-profile-agent.config.js";
import { GoogleBusinessProfileRequestValidator } from "./validation/google-business-profile-request-validator.js";
import type { GbpDataProvider } from "./types/gbp-data-provider.types.js";
import { NullGbpDataProvider } from "./providers/null-gbp-data-provider.js";
import { NapConsistencyBuilder } from "./reporting/nap-consistency-builder.js";
import { ReviewManagementReportBuilder } from "./reporting/review-management-report-builder.js";
import { LocalPerformanceReportBuilder } from "./reporting/local-performance-report-builder.js";
import { GooglePostsPlanBuilder } from "./reporting/google-posts-plan-builder.js";
import { LocalSeoRecommendationBuilder } from "./reporting/local-seo-recommendation-builder.js";
import type {
  GoogleBusinessProfileRequest,
  GoogleBusinessProfileResult,
} from "./types/google-business-profile-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls the Google Business Profile API, Google Maps, Google Search Console, Google " +
  "Analytics 4, BrightLocal, or any other external local-SEO service -- data comes only from the injected " +
  "GbpDataProvider, and this agent never publishes a Google Post or responds to a review itself; it only " +
  "prepares drafts and recommendations for human authorization.";

export class GoogleBusinessProfileAgent {
  constructor(
    private readonly validator: GoogleBusinessProfileRequestValidator,
    private readonly dataProvider: GbpDataProvider,
    private readonly napConsistencyBuilder: NapConsistencyBuilder,
    private readonly reviewManagementReportBuilder: ReviewManagementReportBuilder,
    private readonly localPerformanceReportBuilder: LocalPerformanceReportBuilder,
    private readonly googlePostsPlanBuilder: GooglePostsPlanBuilder,
    private readonly localSeoRecommendationBuilder: LocalSeoRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullGbpDataProvider
   * (no real data source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: GoogleBusinessProfileAgentConfig,
    dataProvider: GbpDataProvider = new NullGbpDataProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<GoogleBusinessProfileAgent> {
    return new GoogleBusinessProfileAgent(
      new GoogleBusinessProfileRequestValidator(),
      dataProvider,
      new NapConsistencyBuilder(),
      new ReviewManagementReportBuilder(),
      new LocalPerformanceReportBuilder(),
      new GooglePostsPlanBuilder(),
      new LocalSeoRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageProfile(request: GoogleBusinessProfileRequest): Promise<GoogleBusinessProfileResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "google-business-profile-agent",
        eventType: "gbp_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "google-business-profile-agent",
      eventType: "gbp_requested",
      details: { requestId: request.id, businessName: request.businessName, websiteUrl: request.websiteUrl },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "google-business-profile-agent",
          eventType: "gbp_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error("Google Business Profile request was rejected by human review due to policy-risk signals.");
      }
    }

    const snapshot = await this.dataProvider.fetchGbpSnapshot({
      businessName: request.businessName,
      websiteUrl: request.websiteUrl,
    });

    const napConsistency = this.napConsistencyBuilder.build(request.expectedNap, snapshot?.nap ?? null);
    const reviewManagement = this.reviewManagementReportBuilder.build(snapshot?.reviews ?? []);
    const localPerformance = this.localPerformanceReportBuilder.build(snapshot?.localSearchPerformance ?? null);
    const googlePostsPlan = this.googlePostsPlanBuilder.build(request.businessName, request.localSeoStrategy);
    const recommendations = this.localSeoRecommendationBuilder.build(
      request.businessName,
      request.websiteUrl,
      napConsistency,
      reviewManagement,
      localPerformance,
    );

    const dataAvailable = snapshot !== null;
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: GoogleBusinessProfileResult = {
      requestId: request.id,
      dataAvailable,
      napConsistency,
      observedCategories: snapshot?.categoryInfo ?? null,
      reviewManagement,
      localPerformance,
      googlePostsPlan,
      recommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "google-business-profile-agent",
      eventType: "gbp_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        recommendationCount: recommendations.length,
        reviewsNeedingResponseCount: reviewManagement.reviewsNeedingResponse.length,
      },
    });

    return result;
  }

  private buildLimitations(request: GoogleBusinessProfileRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [...(request.performanceAnalytics?.limitations ?? []), OUT_OF_SCOPE_LIMITATION];

    if (!request.performanceAnalytics) {
      limitations.push(
        "performanceAnalytics was not supplied; local performance is not cross-referenced against overall organic performance.",
      );
    }
    if (!request.localSeoStrategy) {
      limitations.push("No local SEO strategy was supplied; recommendations reflect listing and review signals only.");
    }
    if (!dataAvailable) {
      limitations.push(
        `No Google Business Profile data provider is configured (using "${this.dataProvider.name}"); NAP, ` +
          "categories, reviews, and local search performance are all unavailable.",
      );
    }

    return limitations;
  }

  private async escalatePolicyRisk(request: GoogleBusinessProfileRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Google Business Profile request "${request.id}" contains term(s) associated with Business Profile ` +
        `policy violations: ${signals.join(", ")}. GLOBAL_RULES.md requires human approval before proceeding.`,
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues Google Business Profile analysis for this business.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "google-business-profile-agent",
      eventType: "gbp_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "google-business-profile-agent",
      eventType: "gbp_escalation_resolved",
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
