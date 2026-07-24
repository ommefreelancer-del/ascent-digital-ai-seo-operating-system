// SEO Content Agent, per Agents/seo-content-agent.md.
//
// Workflow:
//   1. Validate the request: a non-empty businessObjective, and at least
//      one real ContentBrief to draft from -- the Content Strategy Agent
//      already did the topic/keyword/outline work, this agent never
//      re-derives it.
//   2. Log "seo_content_requested".
//   3. Scan for Google-policy-risk signals (plagiarism, keyword stuffing,
//      doorway pages, etc.) across the business objective, brand
//      guidelines, and brief titles. If found, escalate to a human via the
//      same ApprovalChannel/AuditLogger primitives every other agent here
//      uses -- drafting content for a policy-risky topic is not a decision
//      this agent makes alone.
//   4. For every real ContentBrief: draft a meta title/description
//      (deterministic template tied to the brief's real target keyword and
//      classified intent), draft each section's body through the injected
//      ContentGenerationProvider (a bracketed placeholder instruction when
//      no provider is configured or generation is unavailable), and build
//      FAQ question stems only when the brief's own outline calls for an
//      FAQ section.
//   5. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   6. Log "seo_content_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents body
// prose, a real answer to an FAQ question, or a brand name. No external
// service (an LLM provider, per this agent's own spec) is called anywhere
// in this module -- see providers/null-content-generation-provider.ts.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { SeoContentAgentConfig } from "./config/seo-content-agent.config.js";
import { SeoContentRequestValidator } from "./validation/seo-content-request-validator.js";
import type { ContentGenerationProvider } from "./types/content-generation-provider.types.js";
import { NullContentGenerationProvider } from "./providers/null-content-generation-provider.js";
import { MetaContentBuilder } from "./drafting/meta-content-builder.js";
import { FaqBuilder } from "./drafting/faq-builder.js";
import { ContentSectionDrafter } from "./drafting/content-section-drafter.js";
import { ContentPieceAssembler } from "./drafting/content-piece-assembler.js";
import type { ContentPieceDraft, SeoContentRequest, SeoContentResult } from "./types/seo-content-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls ChatGPT, Claude, or any other external content-generation or plagiarism-detection " +
  "service -- generated prose, if any, comes only from the injected ContentGenerationProvider, supplied by the " +
  "caller. Verify originality and EEAT compliance with a real tool before publishing.";

export class SeoContentAgent {
  constructor(
    private readonly validator: SeoContentRequestValidator,
    private readonly contentGenerationProvider: ContentGenerationProvider,
    private readonly metaContentBuilder: MetaContentBuilder,
    private readonly faqBuilder: FaqBuilder,
    private readonly sectionDrafter: ContentSectionDrafter,
    private readonly pieceAssembler: ContentPieceAssembler,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullContentGenerationProvider
   * (no real generation source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: SeoContentAgentConfig,
    contentGenerationProvider: ContentGenerationProvider = new NullContentGenerationProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<SeoContentAgent> {
    return new SeoContentAgent(
      new SeoContentRequestValidator(),
      contentGenerationProvider,
      new MetaContentBuilder(),
      new FaqBuilder(),
      new ContentSectionDrafter(),
      new ContentPieceAssembler(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developContent(request: SeoContentRequest): Promise<SeoContentResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "seo-content-agent",
        eventType: "seo_content_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "seo-content-agent",
      eventType: "seo_content_requested",
      details: { requestId: request.id, briefCount: request.contentStrategy.contentBriefs.length },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "seo-content-agent",
          eventType: "seo_content_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error("SEO content request was rejected by human review due to Google-policy-risk signals.");
      }
    }

    const brandGuidelines = request.brandGuidelines ?? null;
    const contentDrafts: ContentPieceDraft[] = [];
    for (const brief of request.contentStrategy.contentBriefs) {
      const metaContent = this.metaContentBuilder.build(brief, brandGuidelines);
      const sections = await Promise.all(
        brief.recommendedSections.map((heading) =>
          this.sectionDrafter.draftSection(
            this.contentGenerationProvider,
            brief.title,
            brief.targetKeyword,
            heading,
            brandGuidelines,
          ),
        ),
      );
      const faqs = this.faqBuilder.build(brief);
      contentDrafts.push(this.pieceAssembler.assemble(brief, metaContent, sections, faqs));
    }

    const dataAvailable = contentDrafts.some((draft) => draft.sections.some((section) => section.isGenerated));
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: SeoContentResult = {
      requestId: request.id,
      contentDrafts,
      dataAvailable,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "seo-content-agent",
      eventType: "seo_content_completed",
      details: { requestId: request.id, dataAvailable, contentDraftCount: contentDrafts.length },
    });

    return result;
  }

  private buildLimitations(request: SeoContentRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [
      ...request.contentStrategy.limitations,
      ...request.keywordResearch.limitations,
      ...(request.seoStrategy?.limitations ?? []),
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!request.seoStrategy) {
      limitations.push("seoStrategy was not supplied; content drafting order is not prioritized by the roadmap.");
    }
    if (!request.brandGuidelines) {
      limitations.push("No brand guidelines were supplied; brand voice placeholders are generic, not tailored.");
    }
    if (!dataAvailable) {
      limitations.push(
        `No content generation provider is configured (using "${this.contentGenerationProvider.name}"); ` +
          "every section body is a bracketed placeholder instruction, not real, publication-ready prose.",
      );
    }

    return limitations;
  }

  private async escalatePolicyRisk(request: SeoContentRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `SEO content request "${request.id}" contains term(s) associated with manipulative or ` +
        `policy-violating content practices: ${signals.join(", ")}. GLOBAL_RULES.md requires human ` +
        "approval before drafting content for this topic.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with drafting content despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues content drafting for every supplied content brief.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "seo-content-agent",
      eventType: "seo_content_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "seo-content-agent",
      eventType: "seo_content_escalation_resolved",
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
