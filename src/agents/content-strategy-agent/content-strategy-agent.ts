// Content Strategy Agent, per Agents/content-strategy-agent.md.
//
// Workflow:
//   1. Validate the request structurally; throw (and audit-log the failure)
//      on empty/invalid fields.
//   2. Log "content_strategy_requested".
//   3. Scan for Google-policy-risk signals across the business objective and
//      every upstream keyword. If found, escalate to a human via the same
//      ApprovalChannel/AuditLogger primitives the Boss Agent and Keyword
//      Research Agent use.
//   4. Elevate the Keyword Research Agent's keyword-level topic clusters
//      into content-planning clusters (pillar keyword + supporting
//      keywords).
//   5. Build the pillar-page strategy (ranked by cluster size, a real
//      signal, not a fabricated one).
//   6. Derive internal linking recommendations (hub-and-spoke).
//   7. Schedule an editorial calendar from the caller's start date/cadence.
//   8. Analyze content gaps against an optional existing content inventory
//      -- honestly flagged as a default/unverified result when no inventory
//      is supplied, never silently treated as ground truth.
//   9. Build a writing brief for every planned piece of content.
//   10. Compile the result, carrying forward every upstream limitation
//       (e.g. "no metrics provider configured") plus any found here.
//   11. Log "content_strategy_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): every keyword, intent, and
// limitation here traces back to the KeywordResearchResult the caller
// supplied. Nothing about search volume, difficulty, or real-world content
// performance is invented anywhere in this module.
//
// Integration with the Boss Agent: like the Keyword Research Agent, this
// module does not import anything from src/boss-agent (locked). See
// dispatch.ts for the integration seam.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { ContentStrategyAgentConfig } from "./config/content-strategy-agent.config.js";
import type {
  ContentStrategyRequest,
  ContentStrategyResult,
  EditorialCalendarEntry,
} from "./types/content-strategy-request.types.js";
import { ContentStrategyRequestValidator } from "./validation/content-strategy-request-validator.js";
import { ContentTopicClusterBuilder } from "./clustering/content-topic-cluster-builder.js";
import { PillarStrategyBuilder } from "./planning/pillar-strategy-builder.js";
import { InternalLinkingRecommender } from "./planning/internal-linking-recommender.js";
import { EditorialCalendarScheduler } from "./planning/editorial-calendar-scheduler.js";
import { ContentGapAnalyzer } from "./planning/content-gap-analyzer.js";
import { ContentBriefBuilder } from "./planning/content-brief-builder.js";

const PROCEED_CANDIDATE_ID = "proceed";

export class ContentStrategyAgent {
  constructor(
    private readonly validator: ContentStrategyRequestValidator,
    private readonly clusterBuilder: ContentTopicClusterBuilder,
    private readonly pillarStrategyBuilder: PillarStrategyBuilder,
    private readonly linkingRecommender: InternalLinkingRecommender,
    private readonly calendarScheduler: EditorialCalendarScheduler,
    private readonly gapAnalyzer: ContentGapAnalyzer,
    private readonly briefBuilder: ContentBriefBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /** Wires the production implementation, matching how KeywordResearchAgent.create() is wired. */
  static async create(
    config: ContentStrategyAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<ContentStrategyAgent> {
    return new ContentStrategyAgent(
      new ContentStrategyRequestValidator(),
      new ContentTopicClusterBuilder(),
      new PillarStrategyBuilder(),
      new InternalLinkingRecommender(),
      new EditorialCalendarScheduler(),
      new ContentGapAnalyzer(),
      new ContentBriefBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developStrategy(request: ContentStrategyRequest): Promise<ContentStrategyResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "content-strategy-agent",
        eventType: "content_strategy_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "content-strategy-agent",
      eventType: "content_strategy_requested",
      details: {
        requestId: request.id,
        businessObjective: request.businessObjective,
        keywordCount: request.keywordResearch.classifiedKeywords.length,
      },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "content-strategy-agent",
          eventType: "content_strategy_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error(
          "Content strategy request was rejected by human review due to Google-policy-risk signals.",
        );
      }
    }

    const limitations: string[] = [...request.keywordResearch.limitations];

    const topicClusters = this.clusterBuilder.build(request.keywordResearch.topicClusters);
    const pillarPageStrategy = this.pillarStrategyBuilder.build(
      topicClusters,
      request.keywordResearch.classifiedKeywords,
    );
    const internalLinkingRecommendations = this.linkingRecommender.build(pillarPageStrategy);

    const editorialCalendar: EditorialCalendarEntry[] = this.calendarScheduler.build(
      pillarPageStrategy,
      request.calendarStartDate ?? new Date().toISOString(),
      request.articlesPerWeek,
    );

    const { gaps: contentGaps, limitation: gapLimitation } = this.gapAnalyzer.analyze(
      topicClusters,
      request.existingContentInventory,
    );
    if (gapLimitation) {
      limitations.push(gapLimitation);
    }

    const contentBriefs = this.briefBuilder.build(pillarPageStrategy, internalLinkingRecommendations);

    const result: ContentStrategyResult = {
      requestId: request.id,
      topicClusters,
      pillarPageStrategy,
      internalLinkingRecommendations,
      editorialCalendar,
      contentGaps,
      contentBriefs,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "content-strategy-agent",
      eventType: "content_strategy_completed",
      details: {
        requestId: request.id,
        clusterCount: topicClusters.length,
        pillarCount: pillarPageStrategy.length,
        briefCount: contentBriefs.length,
        gapCount: contentGaps.length,
      },
    });

    return result;
  }

  private async escalatePolicyRisk(
    request: ContentStrategyRequest,
    signals: readonly string[],
  ): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Content strategy request "${request.id}" contains term(s) associated with manipulative or ` +
        `policy-violating content practices: ${signals.join(", ")}. GLOBAL_RULES.md requires human ` +
        "approval before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues content strategy development for all supplied keywords.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "content-strategy-agent",
      eventType: "content_strategy_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "content-strategy-agent",
      eventType: "content_strategy_escalation_resolved",
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
