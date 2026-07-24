// Keyword Research & Search Intent Agent, per Agents/keyword-research-agent.md.
//
// Workflow:
//   1. Validate the request structurally; throw (and audit-log the failure)
//      on empty/duplicate/blank fields -- a caller-side data problem, not a
//      judgment call.
//   2. Log "keyword_research_requested".
//   3. Scan for Google-policy-risk signals (keyword stuffing, cloaking,
//      doorway pages, paid links, etc.). If found, escalate to a human via
//      the same ApprovalChannel/AuditLogger primitives the Boss Agent uses --
//      never silently comply, never silently refuse.
//   4. For every seed keyword: classify search intent (deterministic, no
//      external data needed) and attempt a metrics lookup through the
//      configured KeywordDataProvider. A per-keyword lookup failure is
//      recorded as a limitation, not a fatal error for the whole request.
//   5. Build topic clusters from the seed keywords (deterministic term
//      sharing).
//   6. Compile the result with an explicit metricsAvailable flag, a
//      limitations list, and a standing non-guarantee disclaimer -- never
//      silently omitting what could not be determined.
//   7. Log "keyword_research_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): with no KeywordDataProvider
// configured (the default), every keyword's `metrics` is `null` and
// `metricsAvailable` is `false` -- this agent never invents search volume,
// difficulty, or opportunity scores.
//
// Integration with the Boss Agent: this agent does not import anything from
// src/boss-agent -- that module is locked (Phase 7 validation, prior
// session). src/agents/keyword-research-agent/dispatch.ts provides the
// integration seam (isKeywordResearchAssignment) that a caller uses against
// a RoutingDecision produced by TaskRouter, without this agent depending on
// Boss Agent internals or vice versa.
//
// Communication: per the spec's "Communicates With", results are meant to
// flow to the SEO Strategy, Content Strategy, SEO Content, and On-Page SEO
// Agents, plus back to the Boss Agent. None of those agents are implemented
// yet, so no code-level message-passing to them exists -- KeywordResearchResult
// is a plain, JSON-serializable object specifically so those agents can
// consume it directly once they exist.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { KeywordResearchAgentConfig } from "./config/keyword-research-agent.config.js";
import type { KeywordDataProvider } from "./types/keyword-data-provider.types.js";
import type {
  ClassifiedKeyword,
  KeywordResearchRequest,
  KeywordResearchResult,
} from "./types/keyword-request.types.js";
import { KeywordRequestValidator } from "./validation/keyword-request-validator.js";
import { SearchIntentClassifier } from "./intent/search-intent-classifier.js";
import { TopicClusterBuilder } from "./clustering/topic-cluster-builder.js";
import { NullKeywordDataProvider } from "./providers/null-keyword-data-provider.js";

const RANKING_DISCLAIMER =
  "This report does not guarantee search rankings or traffic outcomes; it reflects available signals only, per GLOBAL_RULES.md Section 6.";

const PROCEED_CANDIDATE_ID = "proceed";

export class KeywordResearchAgent {
  constructor(
    private readonly validator: KeywordRequestValidator,
    private readonly intentClassifier: SearchIntentClassifier,
    private readonly clusterBuilder: TopicClusterBuilder,
    private readonly dataProvider: KeywordDataProvider,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullKeywordDataProvider
   * (no real metrics source configured) and the interactive CLI approval
   * channel, matching how BossAgent.create() is wired.
   */
  static async create(
    config: KeywordResearchAgentConfig,
    dataProvider: KeywordDataProvider = new NullKeywordDataProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<KeywordResearchAgent> {
    return new KeywordResearchAgent(
      new KeywordRequestValidator(),
      new SearchIntentClassifier(),
      new TopicClusterBuilder(),
      dataProvider,
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async researchKeywords(request: KeywordResearchRequest): Promise<KeywordResearchResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "keyword-research-agent",
        eventType: "keyword_research_validation_failed",
        details: {
          requestId: request.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "keyword-research-agent",
      eventType: "keyword_research_requested",
      details: {
        requestId: request.id,
        businessObjective: request.businessObjective,
        seedKeywords: request.seedKeywords,
      },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "keyword-research-agent",
          eventType: "keyword_research_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error(
          "Keyword research request was rejected by human review due to Google-policy-risk signals.",
        );
      }
    }

    const limitations: string[] = [];
    const classifiedKeywords: ClassifiedKeyword[] = [];
    let anyMetrics = false;

    for (const keyword of request.seedKeywords) {
      const { intent, rationale } = this.intentClassifier.classify(keyword);
      let metrics: ClassifiedKeyword["metrics"] = null;
      try {
        metrics = await this.dataProvider.fetchMetrics({ keyword });
      } catch (error) {
        limitations.push(
          `Metrics lookup failed for "${keyword}" via ${this.dataProvider.name}: ` +
            `${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      if (metrics) {
        anyMetrics = true;
      }
      classifiedKeywords.push({ keyword, intent, intentRationale: rationale, metrics });
    }

    if (!anyMetrics) {
      limitations.push(
        `No keyword data provider is configured (using "${this.dataProvider.name}"); search volume, ` +
          "difficulty, and opportunity scoring are unavailable for all keywords. Prioritization must " +
          "rely on intent and clustering only, not search volume or competition.",
      );
    }

    const topicClusters = this.clusterBuilder.build(request.seedKeywords);
    const result: KeywordResearchResult = {
      requestId: request.id,
      classifiedKeywords,
      topicClusters,
      metricsAvailable: anyMetrics,
      limitations,
      rankingDisclaimer: RANKING_DISCLAIMER,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "keyword-research-agent",
      eventType: "keyword_research_completed",
      details: {
        requestId: request.id,
        metricsAvailable: anyMetrics,
        keywordCount: classifiedKeywords.length,
        clusterCount: topicClusters.length,
      },
    });

    return result;
  }

  private async escalatePolicyRisk(
    request: KeywordResearchRequest,
    signals: readonly string[],
  ): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Keyword research request "${request.id}" contains term(s) associated with manipulative or ` +
        `policy-violating SEO practices: ${signals.join(", ")}. GLOBAL_RULES.md requires human ` +
        "approval before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues keyword research and classification for all supplied seed keywords.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "keyword-research-agent",
      eventType: "keyword_research_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "keyword-research-agent",
      eventType: "keyword_research_escalation_resolved",
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
