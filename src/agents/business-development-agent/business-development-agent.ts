// Business Development Agent, per Agents/business-development-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty businessGoals, and every real,
//      caller-supplied service portfolio item must have a non-empty
//      serviceName and priceRangeLabel.
//   2. Log "business_development_requested".
//   3. Scan for false-promise policy-risk signals (guaranteed results,
//      100% success, guaranteed ranking, risk-free) across the business
//      goals, market research, and service portfolio text. If found,
//      escalate to a human via the same ApprovalChannel/AuditLogger
//      primitives every other agent here uses -- per this agent's own
//      rule, "never make false promises to prospects."
//   4. Qualify every real lead from the AI CRM Agent's own lead pipeline
//      (a deterministic mapping from its real negotiation stage), build a
//      real sales pipeline summary, draft a service proposal for every
//      qualified lead (only ever referencing real, caller-supplied service
//      portfolio items), and identify growth opportunities and partnership
//      recommendations from real, already-computed CRM data.
//   5. Compile the result with an explicit `dataAvailable` flag (mirroring
//      the AI CRM Agent's own) and limitations carried forward from it
//      plus this agent's own scope disclaimers.
//   6. Log "business_development_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// lead, a qualification, a service, a price, or a growth trend -- every
// field traces to a real, already-computed CRM result or real,
// caller-supplied business context. No external service (HubSpot CRM,
// LinkedIn, an email platform) is called anywhere in this module, and this
// agent never sends a proposal itself.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { BusinessDevelopmentAgentConfig } from "./config/business-development-agent.config.js";
import { BusinessDevelopmentRequestValidator } from "./validation/business-development-request-validator.js";
import { LeadQualifier } from "./development/lead-qualifier.js";
import { SalesPipelineSummaryBuilder } from "./development/sales-pipeline-summary-builder.js";
import { ClientProposalDraftBuilder } from "./development/client-proposal-draft-builder.js";
import { GrowthOpportunityBuilder } from "./development/growth-opportunity-builder.js";
import { PartnershipRecommendationBuilder } from "./development/partnership-recommendation-builder.js";
import type { BusinessDevelopmentRequest, BusinessDevelopmentResult } from "./types/business-development-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls HubSpot CRM, LinkedIn, Google Sheets, Notion, or any other external sales tool, and " +
  "never sends a proposal or message itself -- it only aggregates real, already-computed CRM data and real, " +
  "caller-supplied business context, and prepares drafts for human authorization.";

export class BusinessDevelopmentAgent {
  constructor(
    private readonly validator: BusinessDevelopmentRequestValidator,
    private readonly leadQualifier: LeadQualifier,
    private readonly salesPipelineSummaryBuilder: SalesPipelineSummaryBuilder,
    private readonly clientProposalDraftBuilder: ClientProposalDraftBuilder,
    private readonly growthOpportunityBuilder: GrowthOpportunityBuilder,
    private readonly partnershipRecommendationBuilder: PartnershipRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: BusinessDevelopmentAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<BusinessDevelopmentAgent> {
    return new BusinessDevelopmentAgent(
      new BusinessDevelopmentRequestValidator(),
      new LeadQualifier(),
      new SalesPipelineSummaryBuilder(),
      new ClientProposalDraftBuilder(),
      new GrowthOpportunityBuilder(),
      new PartnershipRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developBusiness(request: BusinessDevelopmentRequest): Promise<BusinessDevelopmentResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "business-development-agent",
        eventType: "business_development_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "business-development-agent",
      eventType: "business_development_requested",
      details: { requestId: request.id, leadCount: request.crmData.leadPipeline.length },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "business-development-agent",
          eventType: "business_development_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error("Business development request was rejected by human review due to policy-risk signals.");
      }
    }

    const qualifiedLeadReport = this.leadQualifier.build(request.crmData.leadPipeline);
    const salesPipelineSummary = this.salesPipelineSummaryBuilder.build(qualifiedLeadReport);
    const clientProposals = this.clientProposalDraftBuilder.build(
      qualifiedLeadReport,
      request.servicePortfolio,
      request.businessGoals,
    );
    const growthOpportunities = this.growthOpportunityBuilder.build(
      request.crmData.clientStatusReport,
      salesPipelineSummary,
      request.marketResearch ?? null,
    );
    const partnershipRecommendations = this.partnershipRecommendationBuilder.build(qualifiedLeadReport);

    const dataAvailable = request.crmData.dataAvailable;
    const limitations: string[] = [...request.crmData.limitations, OUT_OF_SCOPE_LIMITATION];
    if (!dataAvailable) {
      limitations.push("No real CRM data was available; the lead pipeline and sales pipeline summary reflect no real leads.");
    }
    if (!request.marketResearch) {
      limitations.push("No market research was supplied; growth opportunities reflect CRM signals only.");
    }
    if (request.servicePortfolio.length === 0) {
      limitations.push("No service portfolio was supplied; no client proposals could be prepared.");
    }

    const result: BusinessDevelopmentResult = {
      requestId: request.id,
      dataAvailable,
      qualifiedLeadReport,
      salesPipelineSummary,
      clientProposals,
      growthOpportunities,
      partnershipRecommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "business-development-agent",
      eventType: "business_development_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        qualifiedCount: salesPipelineSummary.qualifiedCount,
        proposalCount: clientProposals.length,
      },
    });

    return result;
  }

  private async escalatePolicyRisk(request: BusinessDevelopmentRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Business development request "${request.id}" contains term(s) associated with false or unverifiable ` +
        `promises: ${signals.join(", ")}. GLOBAL_RULES.md requires human approval before proceeding.`,
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues business development analysis and proposal drafting.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "business-development-agent",
      eventType: "business_development_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "business-development-agent",
      eventType: "business_development_escalation_resolved",
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
