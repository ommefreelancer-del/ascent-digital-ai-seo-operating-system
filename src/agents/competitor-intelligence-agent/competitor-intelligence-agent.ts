// Competitor Intelligence Agent, per Agents/competitor-intelligence-agent.md.
//
// Workflow:
//   1. Validate the request: at least one competitor, non-empty html per
//      competitor, no duplicate ids/urls, and no competitor url matching
//      our own site's host -- all thrown (and audit-logged) as genuine data
//      problems, not judgment calls.
//   2. Log "competitor_intelligence_requested".
//   3. If only one competitor was supplied, escalate to a human before
//      presenting a single data point as "the competitive landscape".
//   4. Audit every competitor snapshot with the real, injected
//      WebsiteAuditAgent -- never inventing a competitor result. A
//      competitor whose audit fails (invalid input, or a human declining
//      an ambiguous-input escalation) is skipped and recorded as a
//      limitation, not silently dropped and not a fatal error for the
//      whole request.
//   5. Build the overall gap, technical comparison, and content-cluster
//      coverage from the real audited results, then synthesize
//      recommendations from those -- never from raw competitor text
//      directly, and never suggesting we copy competitor content
//      (GLOBAL_RULES.md SS17).
//   6. Compile the result with limitations carried forward from every
//      upstream result plus this agent's own scope disclaimers, and log
//      "competitor_intelligence_completed".
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): every comparison traces to a
// real, freshly-computed WebsiteAuditResult for each competitor (via actual
// reuse of WebsiteAuditAgent) or to the caller's own already-computed
// TechnicalSeoResult/KeywordResearchResult. No external API is called, no
// search engine is scraped, and no competitor is ever discovered
// automatically -- only caller-supplied snapshots are used.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import { WebsiteAuditAgent } from "../website-audit-agent/website-audit-agent.js";
import type { WebsiteAuditRequest } from "../website-audit-agent/types/website-audit-request.types.js";
import type { CompetitorIntelligenceAgentConfig } from "./config/competitor-intelligence-agent.config.js";
import { CompetitorIntelligenceRequestValidator } from "./validation/competitor-intelligence-request-validator.js";
import { CompetitorOverallGapBuilder } from "./analysis/competitor-overall-gap-builder.js";
import { TechnicalComparisonBuilder } from "./analysis/technical-comparison-builder.js";
import { ContentClusterCoverageBuilder } from "./analysis/content-cluster-coverage-builder.js";
import { CompetitorRecommendationBuilder } from "./analysis/competitor-recommendation-builder.js";
import type { AuditedCompetitor } from "./analysis/audited-competitor.types.js";
import type {
  CompetitorIntelligenceRequest,
  CompetitorIntelligenceResult,
  CompetitorSnapshot,
} from "./types/competitor-intelligence-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

export class CompetitorIntelligenceAgent {
  constructor(
    private readonly validator: CompetitorIntelligenceRequestValidator,
    private readonly websiteAuditAgent: WebsiteAuditAgent,
    private readonly overallGapBuilder: CompetitorOverallGapBuilder,
    private readonly technicalComparisonBuilder: TechnicalComparisonBuilder,
    private readonly contentCoverageBuilder: ContentClusterCoverageBuilder,
    private readonly recommendationBuilder: CompetitorRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Requires a real WebsiteAuditAgent
   * instance (the caller's own, already used to audit our site) so every
   * competitor snapshot is analyzed by the exact same, real auditor.
   */
  static async create(
    config: CompetitorIntelligenceAgentConfig,
    websiteAuditAgent: WebsiteAuditAgent,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<CompetitorIntelligenceAgent> {
    return new CompetitorIntelligenceAgent(
      new CompetitorIntelligenceRequestValidator(),
      websiteAuditAgent,
      new CompetitorOverallGapBuilder(),
      new TechnicalComparisonBuilder(),
      new ContentClusterCoverageBuilder(),
      new CompetitorRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async analyzeCompetitors(request: CompetitorIntelligenceRequest): Promise<CompetitorIntelligenceResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "competitor-intelligence-agent",
        eventType: "competitor_intelligence_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "competitor-intelligence-agent",
      eventType: "competitor_intelligence_requested",
      details: { requestId: request.id, competitorCount: request.competitors.length },
    });

    if (this.validator.looksLowConfidence(request)) {
      const approved = await this.escalateLowConfidence(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "competitor-intelligence-agent",
          eventType: "competitor_intelligence_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with only one competitor supplied.",
          },
        });
        throw new Error(
          "Competitor intelligence request was rejected by human review because only one competitor was supplied.",
        );
      }
    }

    const limitations: string[] = [
      "Competitors are never discovered or fetched automatically; this analysis covers only the caller-supplied snapshots.",
      "Content-cluster coverage is based on each competitor's title and heading text only, not their full page content.",
      ...request.ourWebsiteAudit.limitations,
      ...request.ourTechnicalSeo.limitations,
      ...request.ourKeywordResearch.limitations,
    ];

    const auditedCompetitors: AuditedCompetitor[] = [];
    const successfulSnapshots: CompetitorSnapshot[] = [];

    for (const competitor of request.competitors) {
      try {
        const auditRequest: WebsiteAuditRequest = {
          id: `${request.id}:${competitor.id}`,
          html: competitor.html,
          ...(competitor.url !== undefined && { url: competitor.url }),
          ...(competitor.robotsTxtContent !== undefined && { robotsTxtContent: competitor.robotsTxtContent }),
        };
        const audit = await this.websiteAuditAgent.auditWebsite(auditRequest);
        auditedCompetitors.push({ id: competitor.id, url: competitor.url ?? null, audit });
        successfulSnapshots.push(competitor);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.auditLogger.logEvent({
          actor: "competitor-intelligence-agent",
          eventType: "competitor_intelligence_competitor_skipped",
          details: { requestId: request.id, competitorId: competitor.id, reason },
        });
        limitations.push(`Competitor "${competitor.id}" was skipped: ${reason}`);
      }
    }

    const competitorGapAnalysis = this.overallGapBuilder.build(request.ourWebsiteAudit, auditedCompetitors);
    const technicalComparison = this.technicalComparisonBuilder.build(request.ourTechnicalSeo, auditedCompetitors);
    const contentGapAnalysis = this.contentCoverageBuilder.build(
      request.ourKeywordResearch.topicClusters,
      successfulSnapshots,
    );
    const recommendations = this.recommendationBuilder.build(technicalComparison, contentGapAnalysis);

    const result: CompetitorIntelligenceResult = {
      requestId: request.id,
      competitorGapAnalysis,
      technicalComparison,
      contentGapAnalysis,
      recommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "competitor-intelligence-agent",
      eventType: "competitor_intelligence_completed",
      details: {
        requestId: request.id,
        competitorsAnalyzed: auditedCompetitors.length,
        competitorsSkipped: request.competitors.length - auditedCompetitors.length,
        recommendationCount: recommendations.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: CompetitorIntelligenceRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Competitor intelligence request "${request.id}" supplied only one competitor. Conclusions about ` +
        "competitive positioning drawn from a single data point may not generalize. GLOBAL_RULES.md requires " +
        "human confirmation before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with the single-competitor comparison anyway",
          score: 0,
          rationale: "Approving continues the analysis using only the one supplied competitor.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "competitor-intelligence-agent",
      eventType: "competitor_intelligence_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "competitor-intelligence-agent",
      eventType: "competitor_intelligence_escalation_resolved",
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
