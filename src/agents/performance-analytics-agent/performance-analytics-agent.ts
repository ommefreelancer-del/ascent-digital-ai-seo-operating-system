// Performance & Analytics Agent, per Agents/performance-analytics-agent.md.
//
// Workflow:
//   1. Validate the request: a non-empty url, and that websiteAudit/
//      technicalSeo (when known) agree on which page they describe -- a
//      genuine mismatch throws rather than being silently reconciled.
//   2. Log "performance_analytics_requested".
//   3. Fetch real performance data through the injected PerformanceDataProvider.
//      With no provider configured (the default), this always resolves to
//      `null` -- rankings, traffic, CTR, impressions, and conversions are
//      never fabricated to fill the gap.
//   4. If real ranking data shows the page actively ranking while the
//      website audit independently flags a critical noindex directive,
//      escalate to a human before drawing conclusions from either signal
//      alone.
//   5. Build ranking/traffic/Core-Web-Vitals insights from whatever real
//      data was returned (empty/null when unavailable), then derive
//      opportunities, an ROI estimate (only when real conversions and a
//      real average conversion value are both present), and prioritized
//      recommendations from those real insights.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   7. Log "performance_analytics_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// ranking, traffic figure, CTR, impression count, or conversion value.
// No external API (Google Search Console, Google Analytics, Ahrefs,
// SEMrush) is called anywhere in this module -- see
// providers/null-performance-data-provider.ts.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { PerformanceAnalyticsAgentConfig } from "./config/performance-analytics-agent.config.js";
import { PerformanceAnalyticsRequestValidator } from "./validation/performance-analytics-request-validator.js";
import type { PerformanceDataProvider } from "./types/performance-data-provider.types.js";
import { NullPerformanceDataProvider } from "./providers/null-performance-data-provider.js";
import { RankingInsightBuilder } from "./synthesis/ranking-insight-builder.js";
import { TrafficInsightBuilder } from "./synthesis/traffic-insight-builder.js";
import { CoreWebVitalsInsightBuilder } from "./synthesis/core-web-vitals-insight-builder.js";
import { RoiInsightBuilder } from "./synthesis/roi-insight-builder.js";
import { PerformanceOpportunityBuilder } from "./synthesis/performance-opportunity-builder.js";
import { PerformanceRecommendationBuilder } from "./synthesis/performance-recommendation-builder.js";
import type {
  PerformanceAnalyticsRequest,
  PerformanceAnalyticsResult,
} from "./types/performance-analytics-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Google Search Console, Google Analytics, Ahrefs, SEMrush, or any other external " +
  "analytics API -- all performance data comes only from the injected PerformanceDataProvider, supplied by the caller.";

export class PerformanceAnalyticsAgent {
  constructor(
    private readonly validator: PerformanceAnalyticsRequestValidator,
    private readonly dataProvider: PerformanceDataProvider,
    private readonly rankingInsightBuilder: RankingInsightBuilder,
    private readonly trafficInsightBuilder: TrafficInsightBuilder,
    private readonly coreWebVitalsInsightBuilder: CoreWebVitalsInsightBuilder,
    private readonly roiInsightBuilder: RoiInsightBuilder,
    private readonly opportunityBuilder: PerformanceOpportunityBuilder,
    private readonly recommendationBuilder: PerformanceRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullPerformanceDataProvider
   * (no real data source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: PerformanceAnalyticsAgentConfig,
    dataProvider: PerformanceDataProvider = new NullPerformanceDataProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<PerformanceAnalyticsAgent> {
    return new PerformanceAnalyticsAgent(
      new PerformanceAnalyticsRequestValidator(),
      dataProvider,
      new RankingInsightBuilder(),
      new TrafficInsightBuilder(),
      new CoreWebVitalsInsightBuilder(),
      new RoiInsightBuilder(),
      new PerformanceOpportunityBuilder(),
      new PerformanceRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async analyzePerformance(request: PerformanceAnalyticsRequest): Promise<PerformanceAnalyticsResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "performance-analytics-agent",
        eventType: "performance_analytics_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "performance-analytics-agent",
      eventType: "performance_analytics_requested",
      details: { requestId: request.id, url: request.url },
    });

    const performanceData = await this.dataProvider.fetchPerformanceData({
      url: request.url,
      keywords: request.keywordResearch.classifiedKeywords.map((keyword) => keyword.keyword),
    });

    if (this.validator.looksAmbiguous(request, performanceData)) {
      const approved = await this.escalateAmbiguousRanking(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "performance-analytics-agent",
          eventType: "performance_analytics_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed given the noindex/active-ranking contradiction.",
          },
        });
        throw new Error(
          "Performance analytics request was rejected by human review because the page is both flagged " +
            "noindex and shows real ranking activity.",
        );
      }
    }

    const rankingInsights = this.rankingInsightBuilder.build(performanceData?.rankings ?? []);
    const trafficInsight = this.trafficInsightBuilder.build(performanceData?.traffic ?? null);
    const coreWebVitalInsights = this.coreWebVitalsInsightBuilder.build(performanceData?.coreWebVitals ?? null);
    const roiInsight = this.roiInsightBuilder.build(performanceData?.traffic ?? null);
    const opportunities = this.opportunityBuilder.build(rankingInsights, trafficInsight, coreWebVitalInsights);
    const recommendations = this.recommendationBuilder.build(
      rankingInsights,
      trafficInsight,
      coreWebVitalInsights,
      roiInsight,
    );

    const dataAvailable = performanceData !== null;
    const limitations = this.buildLimitations(request, performanceData, roiInsight, dataAvailable);

    const result: PerformanceAnalyticsResult = {
      requestId: request.id,
      url: request.url,
      dataAvailable,
      rankingInsights,
      trafficInsight,
      coreWebVitalInsights,
      lighthouseCategoryScores: performanceData?.categoryScores ?? null,
      opportunities,
      roiInsight,
      recommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "performance-analytics-agent",
      eventType: "performance_analytics_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        opportunityCount: opportunities.length,
        recommendationCount: recommendations.length,
        roiEstimated: roiInsight !== null,
      },
    });

    return result;
  }

  private buildLimitations(
    request: PerformanceAnalyticsRequest,
    performanceData: Awaited<ReturnType<PerformanceDataProvider["fetchPerformanceData"]>>,
    roiInsight: PerformanceAnalyticsResult["roiInsight"],
    dataAvailable: boolean,
  ): string[] {
    const limitations: string[] = [
      ...request.keywordResearch.limitations,
      ...request.websiteAudit.limitations,
      ...request.technicalSeo.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!dataAvailable) {
      limitations.push(
        `No performance data provider is configured (using "${this.dataProvider.name}"); rankings, traffic, ` +
          "CTR, impressions, conversions, and Core Web Vitals are all unavailable for this page.",
      );
      return limitations;
    }

    const trackedKeywords = performanceData?.rankings.length ?? 0;
    const rankedKeywords = performanceData?.rankings.filter((r) => r.position !== null).length ?? 0;
    if (rankedKeywords < trackedKeywords) {
      limitations.push(
        `${trackedKeywords - rankedKeywords} of ${trackedKeywords} tracked keyword(s) have no real ranking data.`,
      );
    }
    if (!performanceData?.traffic) {
      limitations.push("No traffic snapshot was supplied by the performance data provider.");
    }
    if (!performanceData?.coreWebVitals) {
      limitations.push("No Core Web Vitals snapshot was supplied by the performance data provider.");
    }
    if (performanceData?.traffic && !roiInsight) {
      limitations.push(
        "ROI could not be estimated: real conversions and/or a real average conversion value were not both supplied.",
      );
    }

    return limitations;
  }

  private async escalateAmbiguousRanking(request: PerformanceAnalyticsRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "ambiguous_match",
      summary:
        `Performance analytics request "${request.id}" shows real ranking activity for this page while the ` +
        "website audit independently flags a critical noindex directive. GLOBAL_RULES.md requires human " +
        "confirmation before drawing conclusions from either signal alone.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with the performance analysis despite the noindex/ranking contradiction",
          score: 0,
          rationale: "Approving continues performance analysis for this page.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "performance-analytics-agent",
      eventType: "performance_analytics_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "performance-analytics-agent",
      eventType: "performance_analytics_escalation_resolved",
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
