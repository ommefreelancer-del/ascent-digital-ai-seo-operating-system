// Reply & Negotiation Agent, per Agents/reply-negotiation-agent.md.
//
// Workflow:
//   1. Validate the request: real, internally consistent target pricing
//      (positive target price, max acceptable price at or above it, a
//      non-empty currency).
//   2. Log "reply_negotiation_requested".
//   3. For every real domain the Outreach Agent actually drafted outreach
//      for (real evidence of contact -- never an invented domain), fetch
//      real replies through the injected PublisherReplyProvider. With no
//      provider configured (the default), this always resolves to `null`
//      -- no reply, quoted price, or conversation is ever fabricated to
//      fill the gap.
//   4. Build a conversation summary, real extracted quoted terms, a
//      negotiation recommendation (comparing the real quoted price against
//      real target pricing), and a draft reply for every domain.
//   5. If any domain's real quoted price already meets the real target
//      price, escalate once to a human to confirm those as final agreed
//      pricing -- per this agent's own rule, "never agree to pricing
//      without user approval." Declining does not fail the request; it
//      simply leaves those domains' negotiations open (never a hard
//      rejection, since not confirming a price in one round is a normal,
//      expected outcome, not an error).
//   6. Compile the result with an explicit `dataAvailable` flag, a full
//      negotiation-status entry for every domain checked, and limitations
//      carried forward from both upstream results plus this agent's own
//      scope disclaimers.
//   7. Log "reply_negotiation_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// publisher reply, a quoted price, or an agreement. No external service
// (Gmail, another email platform) is called anywhere in this module -- see
// providers/null-publisher-reply-provider.ts. GLOBAL_RULES.md SS9 /
// PROJECT_OVERVIEW.md: this agent never sends a message and never agrees
// to pricing on its own -- every draft requires human approval, and every
// final agreed price requires an explicit human confirmation via the
// `pricing_agreement` escalation.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { ReplyNegotiationAgentConfig } from "./config/reply-negotiation-agent.config.js";
import { ReplyNegotiationRequestValidator } from "./validation/reply-negotiation-request-validator.js";
import type { PublisherReplyProvider } from "./types/publisher-reply-provider.types.js";
import { NullPublisherReplyProvider } from "./providers/null-publisher-reply-provider.js";
import { ConversationSummaryBuilder } from "./negotiation/conversation-summary-builder.js";
import { QuotedTermsBuilder } from "./negotiation/quoted-terms-builder.js";
import { NegotiationRecommendationBuilder } from "./negotiation/negotiation-recommendation-builder.js";
import { NegotiationReplyDraftBuilder } from "./negotiation/negotiation-reply-draft-builder.js";
import { NegotiationStatusBuilder } from "./negotiation/negotiation-status-builder.js";
import type {
  ConversationSummary,
  FinalAgreedPrice,
  NegotiationReplyDraft,
  NegotiationRecommendation,
  NegotiationStatusEntry,
  QuotedTerms,
  ReplyNegotiationRequest,
  ReplyNegotiationResult,
} from "./types/reply-negotiation-request.types.js";

const CONFIRM_CANDIDATE_ID = "confirm";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Gmail or any other external email platform and never sends a message or finalizes a " +
  "price itself -- reply data comes only from the injected PublisherReplyProvider, and every draft and " +
  "agreement requires explicit human approval.";

interface DomainNegotiation {
  readonly domain: string;
  readonly snapshotObtained: boolean;
  readonly conversationSummary: ConversationSummary;
  readonly quotedTerms: QuotedTerms;
  readonly recommendation: NegotiationRecommendation;
  readonly draft: NegotiationReplyDraft;
}

export class ReplyNegotiationAgent {
  constructor(
    private readonly validator: ReplyNegotiationRequestValidator,
    private readonly replyProvider: PublisherReplyProvider,
    private readonly summaryBuilder: ConversationSummaryBuilder,
    private readonly quotedTermsBuilder: QuotedTermsBuilder,
    private readonly recommendationBuilder: NegotiationRecommendationBuilder,
    private readonly draftBuilder: NegotiationReplyDraftBuilder,
    private readonly statusBuilder: NegotiationStatusBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullPublisherReplyProvider
   * (no real reply source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: ReplyNegotiationAgentConfig,
    replyProvider: PublisherReplyProvider = new NullPublisherReplyProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<ReplyNegotiationAgent> {
    return new ReplyNegotiationAgent(
      new ReplyNegotiationRequestValidator(),
      replyProvider,
      new ConversationSummaryBuilder(),
      new QuotedTermsBuilder(),
      new NegotiationRecommendationBuilder(),
      new NegotiationReplyDraftBuilder(),
      new NegotiationStatusBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async manageNegotiations(request: ReplyNegotiationRequest): Promise<ReplyNegotiationResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "reply-negotiation-agent",
        eventType: "reply_negotiation_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "reply-negotiation-agent",
      eventType: "reply_negotiation_requested",
      details: { requestId: request.id, contactedDomainCount: request.outreach.outreachDrafts.length },
    });

    const domains = Array.from(new Set(request.outreach.outreachDrafts.map((draft) => draft.domain)));
    const senderName = request.senderName ?? null;
    const businessRules = request.businessRules ?? null;

    const negotiations: DomainNegotiation[] = await Promise.all(
      domains.map(async (domain) => {
        const snapshot = await this.replyProvider.fetchReplies({ domain });
        const replies = snapshot?.replies ?? [];
        const conversationSummary = this.summaryBuilder.build(domain, replies);
        const quotedTerms = this.quotedTermsBuilder.build(domain, replies);
        const recommendation = this.recommendationBuilder.build(quotedTerms, request.targetPricing);
        const draft = this.draftBuilder.build(recommendation, request.targetPricing, businessRules, senderName);
        return { domain, snapshotObtained: snapshot !== null, conversationSummary, quotedTerms, recommendation, draft };
      }),
    );

    const dataAvailable = negotiations.some((n) => n.snapshotObtained);
    const withinTarget = negotiations.filter((n) => n.recommendation.assessment === "within-target");

    let confirmedDomains = new Set<string>();
    if (withinTarget.length > 0) {
      confirmedDomains = await this.escalatePricingAgreement(request, withinTarget);
    }

    const finalAgreedPricing: FinalAgreedPrice[] = withinTarget
      .filter((n) => confirmedDomains.has(n.domain))
      .map((n) => ({
        domain: n.domain,
        agreedPrice: n.quotedTerms.quotedPrice as number,
        currency: request.targetPricing.currency,
        confirmedAt: new Date().toISOString(),
      }));

    const negotiationStatusReport: NegotiationStatusEntry[] = negotiations.map((n) =>
      this.statusBuilder.build(n.quotedTerms, n.recommendation, confirmedDomains.has(n.domain)),
    );

    const limitations: string[] = [
      ...request.outreach.limitations,
      ...request.campaignTracking.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];
    if (!dataAvailable) {
      limitations.push(
        `No publisher reply data provider is configured (using "${this.replyProvider.name}"); no replies could ` +
          "be retrieved for any domain.",
      );
    }
    if (request.campaignTracking.campaignStatus.phase === "not-started") {
      limitations.push("The campaign has not started outreach yet, per Campaign Tracking; no replies are expected.");
    }

    const result: ReplyNegotiationResult = {
      requestId: request.id,
      dataAvailable,
      conversationSummaries: negotiations.map((n) => n.conversationSummary),
      quotedTerms: negotiations.map((n) => n.quotedTerms),
      negotiationRecommendations: negotiations.map((n) => n.recommendation),
      replyDrafts: negotiations.map((n) => n.draft),
      finalAgreedPricing,
      negotiationStatusReport,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "reply-negotiation-agent",
      eventType: "reply_negotiation_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        domainCount: negotiations.length,
        finalAgreedCount: finalAgreedPricing.length,
      },
    });

    return result;
  }

  private async escalatePricingAgreement(
    request: ReplyNegotiationRequest,
    withinTarget: readonly DomainNegotiation[],
  ): Promise<Set<string>> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "pricing_agreement",
      summary:
        `Reply negotiation request "${request.id}" has ${withinTarget.length} real quoted price(s) that meet ` +
        `the target price: ${withinTarget.map((n) => `${n.domain} (${request.targetPricing.currency}${n.quotedTerms.quotedPrice})`).join(", ")}. ` +
        "GLOBAL_RULES.md and PROJECT_OVERVIEW.md require human confirmation before recording these as final " +
        "agreed pricing.",
      candidates: [
        {
          id: CONFIRM_CANDIDATE_ID,
          label: "Confirm these quoted prices as final agreed pricing",
          score: 0,
          rationale: "Confirming records these domains' real quoted prices as final agreed pricing.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "reply-negotiation-agent",
      eventType: "reply_negotiation_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, domains: withinTarget.map((n) => n.domain) },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "reply-negotiation-agent",
      eventType: "reply_negotiation_escalation_resolved",
      details: {
        requestId: request.id,
        approvalRequestId: approvalRequest.id,
        outcome: decision.outcome,
        notes: decision.notes,
      },
    });

    const confirmed = decision.outcome === "candidate_selected" && decision.selectedCandidateId === CONFIRM_CANDIDATE_ID;
    return confirmed ? new Set(withinTarget.map((n) => n.domain)) : new Set();
  }
}
