// Technical SEO Agent, per Agents/technical-seo-agent.md.
//
// Workflow:
//   1. Validate the request: every crossFunctionalNotes entry must parse
//      into the exact format CrossFunctionalNotesBuilder produces and must
//      correlate to a real finding in the supplied websiteAudit -- a
//      mismatch throws (and is audit-logged) as a genuine data-integrity
//      problem, not a judgment call.
//   2. Log "technical_seo_requested".
//   3. If the page is blocked from indexing by two independent mechanisms
//      at once (noindex *and* robots.txt Disallow), escalate to a human
//      before recommending fixes for both -- it could be a deliberately
//      excluded page, not a mistake.
//   4. Run all 4 recommenders against the real audit findings, cross-
//      referencing the On-Page SEO Agent's cross-functional notes to mark
//      independently-confirmed findings.
//   5. Compile the result with limitations carried forward from the
//      Website Audit Agent, plus an explicit statement of what this build
//      does not cover (Core Web Vitals, page speed, crawl errors, JS
//      rendering -- all of which need real external data this build does
//      not have).
//   6. Log "technical_seo_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): every recommendation traces to
// a real WebsiteAuditResult finding. No external API is called and no
// metric (Core Web Vitals score, crawl stats, etc.) is invented anywhere.
//
// Integration with the Boss Agent: like the other specialist agents, this
// module does not import anything from src/boss-agent (locked). See
// dispatch.ts for the integration seam.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { TechnicalSeoAgentConfig } from "./config/technical-seo-agent.config.js";
import { TechnicalSeoRequestValidator } from "./validation/technical-seo-request-validator.js";
import type {
  TechnicalSeoRecommendationContext,
  TechnicalSeoRecommender,
} from "./recommendations/technical-seo-recommender.js";
import { CrawlabilityRecommender } from "./recommendations/crawlability-recommender.js";
import { RobotsTxtRecommender } from "./recommendations/robots-txt-recommender.js";
import { HttpsRecommender } from "./recommendations/https-recommender.js";
import { PageStructureRecommender } from "./recommendations/page-structure-recommender.js";
import type { TechnicalSeoRequest, TechnicalSeoResult } from "./types/technical-seo-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent covers only crawlability, robots.txt, HTTPS, and basic page structure (doctype/lang/viewport) " +
  "-- the technical categories determinable from a structural audit alone. Core Web Vitals, page speed, " +
  "Search Console crawl-error reports, and JavaScript-rendering analysis all require real external data " +
  "this build does not call, and are out of scope.";

function defaultRecommenders(): TechnicalSeoRecommender[] {
  return [
    new CrawlabilityRecommender(),
    new RobotsTxtRecommender(),
    new HttpsRecommender(),
    new PageStructureRecommender(),
  ];
}

export class TechnicalSeoAgent {
  constructor(
    private readonly validator: TechnicalSeoRequestValidator,
    private readonly recommenders: readonly TechnicalSeoRecommender[],
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: TechnicalSeoAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<TechnicalSeoAgent> {
    return new TechnicalSeoAgent(
      new TechnicalSeoRequestValidator(),
      defaultRecommenders(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async generateRecommendations(request: TechnicalSeoRequest): Promise<TechnicalSeoResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "technical-seo-agent",
        eventType: "technical_seo_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "technical-seo-agent",
      eventType: "technical_seo_requested",
      details: { requestId: request.id, url: request.websiteAudit.url },
    });

    if (this.validator.looksAmbiguous(request.websiteAudit)) {
      const approved = await this.escalateAmbiguousBlocking(request);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "technical-seo-agent",
          eventType: "technical_seo_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed given both noindex and robots.txt Disallow are present.",
          },
        });
        throw new Error(
          "Technical SEO request was rejected by human review because the page is blocked from indexing by " +
            "two independent mechanisms at once.",
        );
      }
    }

    const context: TechnicalSeoRecommendationContext = {
      websiteAudit: request.websiteAudit,
      crossFunctionalNotes: request.crossFunctionalNotes,
    };
    const recommendations = this.recommenders.flatMap((recommender) => recommender.recommend(context));

    const result: TechnicalSeoResult = {
      requestId: request.id,
      url: request.websiteAudit.url,
      recommendations,
      limitations: [OUT_OF_SCOPE_LIMITATION, ...request.websiteAudit.limitations],
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "technical-seo-agent",
      eventType: "technical_seo_completed",
      details: {
        requestId: request.id,
        recommendationCount: recommendations.length,
        confirmedCount: recommendations.filter((r) => r.confirmedByCrossFunctionalNote).length,
      },
    });

    return result;
  }

  private async escalateAmbiguousBlocking(request: TechnicalSeoRequest): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "ambiguous_match",
      summary:
        `Technical SEO request "${request.id}" shows this page blocked from indexing by both a noindex ` +
        "directive and a robots.txt Disallow rule at once. This could be a deliberate exclusion (e.g. a " +
        "staging or internal page) rather than a mistake -- GLOBAL_RULES.md requires human confirmation " +
        "before recommending both be removed.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with recommending fixes for both the noindex directive and the robots.txt Disallow rule",
          score: 0,
          rationale: "Approving continues technical recommendation generation for this page.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "technical-seo-agent",
      eventType: "technical_seo_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "technical-seo-agent",
      eventType: "technical_seo_escalation_resolved",
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
