// SEO Strategy Agent, per "Agents/SEO Strategy Agent.md".
//
// Workflow:
//   1. Validate the request: a non-empty businessObjective, and that
//      websiteAudit/technicalSeo/onPageSeo (when known) agree on which
//      page they describe -- a genuine mismatch throws rather than being
//      silently reconciled.
//   2. Log "seo_strategy_requested".
//   3. If competitor intelligence produced zero successfully analyzed
//      competitors, escalate to a human before presenting a strategy that
//      claims to weigh competitive positioning but actually has none.
//   4. Collect every already-computed recommendation from Technical SEO,
//      On-Page SEO (if supplied), Content Strategy (if supplied), and
//      Competitor Intelligence into uniformly-scored StrategyItems.
//   5. Classify into the prioritization matrix, schedule into the 30/60/90
//      -day roadmap, and flatten into a numbered implementation plan.
//   6. Compile the result with limitations carried forward from every
//      upstream result, explicit notes for any optional input that was
//      omitted, and a standing Performance Analytics scope disclaimer.
//   7. Log "seo_strategy_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent invents nothing --
// every StrategyItem traces to a real recommendation, finding, or cluster
// already computed by another agent. No external API is called and no LLM
// is used anywhere in this module.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { SeoStrategyAgentConfig } from "./config/seo-strategy-agent.config.js";
import { SeoStrategyRequestValidator } from "./validation/seo-strategy-request-validator.js";
import { StrategyItemCollector } from "./synthesis/strategy-item-collector.js";
import { PrioritizationMatrixBuilder } from "./synthesis/prioritization-matrix-builder.js";
import { RoadmapBuilder } from "./synthesis/roadmap-builder.js";
import { ImplementationPlanBuilder } from "./synthesis/implementation-plan-builder.js";
import type { SeoStrategyRequest, SeoStrategyResult } from "./types/seo-strategy-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const PERFORMANCE_ANALYTICS_LIMITATION =
  "This strategy does not include Performance Analytics (real traffic, rankings, or conversions), since " +
  "this build calls no external analytics API; prioritization relies on structural and competitive signals only.";

export class SeoStrategyAgent {
  constructor(
    private readonly validator: SeoStrategyRequestValidator,
    private readonly itemCollector: StrategyItemCollector,
    private readonly matrixBuilder: PrioritizationMatrixBuilder,
    private readonly roadmapBuilder: RoadmapBuilder,
    private readonly planBuilder: ImplementationPlanBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: SeoStrategyAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<SeoStrategyAgent> {
    return new SeoStrategyAgent(
      new SeoStrategyRequestValidator(),
      new StrategyItemCollector(),
      new PrioritizationMatrixBuilder(),
      new RoadmapBuilder(),
      new ImplementationPlanBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developStrategy(request: SeoStrategyRequest): Promise<SeoStrategyResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "seo-strategy-agent",
        eventType: "seo_strategy_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "seo-strategy-agent",
      eventType: "seo_strategy_requested",
      details: { requestId: request.id, businessObjective: request.businessObjective },
    });

    if (this.validator.looksLowConfidence(request)) {
      const approved = await this.escalateLowConfidence(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "seo-strategy-agent",
          eventType: "seo_strategy_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed without any successfully analyzed competitors.",
          },
        });
        throw new Error(
          "SEO strategy request was rejected by human review because competitor intelligence produced no " +
            "successfully analyzed competitors.",
        );
      }
    }

    const strategy = this.itemCollector.collect(request);
    const prioritizationMatrix = this.matrixBuilder.build(strategy);
    const roadmap = this.roadmapBuilder.build(prioritizationMatrix);
    const implementationPlan = this.planBuilder.build(roadmap);

    const limitations: string[] = [
      ...request.keywordResearch.limitations,
      ...request.websiteAudit.limitations,
      ...request.technicalSeo.limitations,
      ...request.competitorIntelligence.limitations,
      ...(request.contentStrategy?.limitations ?? []),
      ...(request.onPageSeo?.limitations ?? []),
    ];
    if (!request.contentStrategy) {
      limitations.push(
        "contentStrategy was not supplied; content-creation opportunities are not reflected in this strategy.",
      );
    }
    if (!request.onPageSeo) {
      limitations.push("onPageSeo was not supplied; on-page recommendations are not reflected in this strategy.");
    }
    limitations.push(PERFORMANCE_ANALYTICS_LIMITATION);

    const result: SeoStrategyResult = {
      requestId: request.id,
      strategy,
      prioritizationMatrix,
      roadmap,
      implementationPlan,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "seo-strategy-agent",
      eventType: "seo_strategy_completed",
      details: {
        requestId: request.id,
        itemCount: strategy.length,
        quickWinCount: prioritizationMatrix.quickWins.length,
        majorProjectCount: prioritizationMatrix.majorProjects.length,
        deprioritizedCount: roadmap.deprioritized.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: SeoStrategyRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `SEO strategy request "${request.id}" received a Competitor Intelligence result with zero ` +
        "successfully analyzed competitors, so the competitive dimension of this strategy would be empty. " +
        "GLOBAL_RULES.md requires human confirmation before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with the strategy despite having no analyzed competitors",
          score: 0,
          rationale: "Approving continues strategy synthesis using only the non-competitive inputs.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "seo-strategy-agent",
      eventType: "seo_strategy_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "seo-strategy-agent",
      eventType: "seo_strategy_escalation_resolved",
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
