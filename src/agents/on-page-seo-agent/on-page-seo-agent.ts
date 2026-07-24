// On-Page SEO Agent, per Agents/on-page-seo-agent.md.
//
// Workflow:
//   1. Validate the request structurally; throw (and audit-log the failure)
//      if targetKeyword is empty or doesn't match a keyword the Keyword
//      Research Agent actually researched.
//   2. Log "on_page_seo_requested".
//   3. Scan for Google-policy-risk signals across the target keyword and
//      the audit findings' own text. If found, escalate to a human via the
//      same ApprovalChannel/AuditLogger primitives every other agent here
//      uses.
//   4. Look up the target keyword's real classified intent from the
//      Keyword Research Agent's result.
//   5. Run every on-page recommender against the real Website Audit
//      findings -- each one only recommends a fix for a category the audit
//      actually flagged (or, for keyword-usage, always evaluates against
//      the real target keyword and URL).
//   6. Surface any critical/warning findings outside this agent's scope as
//      cross-functional notes instead of silently dropping or "fixing"
//      them here.
//   7. Compile the result with explicit limitations and log
//      "on_page_seo_completed".
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): no keyword metric is invented
// anywhere in this module -- recommendations are tied to the real,
// already-classified intent and to findings the Website Audit Agent already
// produced. No external API is called and no LLM rewrites any content;
// suggested copy uses deterministic templates with bracketed placeholders
// for anything this agent cannot know (brand name, specific offers).

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { OnPageSeoAgentConfig } from "./config/on-page-seo-agent.config.js";
import { OnPageSeoRequestValidator } from "./validation/on-page-seo-request-validator.js";
import type { OnPageRecommendationContext, OnPageRecommender } from "./recommendations/on-page-recommender.js";
import { TitleMetaRecommender } from "./recommendations/title-meta-recommender.js";
import { HeadingRecommender } from "./recommendations/heading-recommender.js";
import { CanonicalRecommender } from "./recommendations/canonical-recommender.js";
import { OnPageInternalLinkRecommender } from "./recommendations/internal-link-recommender.js";
import { ImageAltRecommender } from "./recommendations/image-alt-recommender.js";
import { StructuredDataRecommender } from "./recommendations/structured-data-recommender.js";
import { KeywordUsageRecommender } from "./recommendations/keyword-usage-recommender.js";
import { CrossFunctionalNotesBuilder } from "./recommendations/cross-functional-notes-builder.js";
import type { OnPageSeoRequest, OnPageSeoResult } from "./types/on-page-seo-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

function defaultRecommenders(): OnPageRecommender[] {
  return [
    new TitleMetaRecommender(),
    new HeadingRecommender(),
    new CanonicalRecommender(),
    new OnPageInternalLinkRecommender(),
    new ImageAltRecommender(),
    new StructuredDataRecommender(),
    new KeywordUsageRecommender(),
  ];
}

export class OnPageSeoAgent {
  constructor(
    private readonly validator: OnPageSeoRequestValidator,
    private readonly recommenders: readonly OnPageRecommender[],
    private readonly notesBuilder: CrossFunctionalNotesBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: OnPageSeoAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<OnPageSeoAgent> {
    return new OnPageSeoAgent(
      new OnPageSeoRequestValidator(),
      defaultRecommenders(),
      new CrossFunctionalNotesBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async generateRecommendations(request: OnPageSeoRequest): Promise<OnPageSeoResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "on-page-seo-agent",
        eventType: "on_page_seo_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "on-page-seo-agent",
      eventType: "on_page_seo_requested",
      details: { requestId: request.id, targetKeyword: request.targetKeyword, url: request.websiteAudit.url },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "on-page-seo-agent",
          eventType: "on_page_seo_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error(
          "On-page SEO request was rejected by human review due to Google-policy-risk signals.",
        );
      }
    }

    const normalizedTarget = request.targetKeyword.trim().toLowerCase();
    const classified = request.keywordResearch.classifiedKeywords.find(
      (keyword) => keyword.keyword.trim().toLowerCase() === normalizedTarget,
    );
    if (!classified) {
      // The validator already guarantees this exists; this is a defense-in-depth guard, not a normal path.
      throw new Error(`Internal error: targetKeyword "${request.targetKeyword}" resolved to no classification.`);
    }

    const context: OnPageRecommendationContext = {
      websiteAudit: request.websiteAudit,
      targetKeyword: request.targetKeyword,
      intent: classified.intent,
    };

    const recommendations = this.recommenders.flatMap((recommender) => recommender.recommend(context));
    const crossFunctionalNotes = this.notesBuilder.build(context);

    const limitations: string[] = [
      "Recommendations are based only on the supplied WebsiteAuditResult findings and KeywordResearchResult " +
        "classification -- this agent does not have the page's raw body content, so keyword-placement " +
        "guidance is prescriptive, not a verified check of the current page.",
      ...request.keywordResearch.limitations,
      ...request.websiteAudit.limitations,
    ];

    const result: OnPageSeoResult = {
      requestId: request.id,
      url: request.websiteAudit.url,
      targetKeyword: request.targetKeyword,
      recommendations,
      crossFunctionalNotes,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "on-page-seo-agent",
      eventType: "on_page_seo_completed",
      details: {
        requestId: request.id,
        recommendationCount: recommendations.length,
        crossFunctionalNoteCount: crossFunctionalNotes.length,
      },
    });

    return result;
  }

  private async escalatePolicyRisk(request: OnPageSeoRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `On-page SEO request "${request.id}" contains term(s) associated with manipulative or ` +
        `policy-violating on-page practices: ${signals.join(", ")}. GLOBAL_RULES.md requires human ` +
        "approval before proceeding.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues on-page recommendation generation for the target keyword.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "on-page-seo-agent",
      eventType: "on_page_seo_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "on-page-seo-agent",
      eventType: "on_page_seo_escalation_resolved",
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
