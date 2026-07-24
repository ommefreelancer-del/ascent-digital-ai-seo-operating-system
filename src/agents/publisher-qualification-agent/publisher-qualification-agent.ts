// Publisher Qualification Agent, per Agents/publisher-qualification-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignRequirements/targetNiche.
//   2. Log "publisher_qualification_requested".
//   3. Qualify every real prospect from the Prospecting Agent's own result
//      against real evidence only: niche relevance is checked
//      deterministically against the prospect's own real title/notes text,
//      and quality (domain authority, spam score) comes from the injected
//      PublisherQualityProvider. With no provider configured (the
//      default), every prospect is rejected with a note explaining why --
//      per this agent's own rule, "forward only qualified prospects",
//      nothing is approved without real evidence behind it.
//   4. If real quality evidence was obtained but nothing was approved,
//      escalate to a human before forwarding an empty approved list to the
//      Contact Intelligence Agent. When no evidence was available at all,
//      this is skipped -- that gap is a limitation, not a judgment call
//      being made on missing data.
//   5. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from the Prospecting result plus this
//      agent's own scope disclaimers.
//   6. Log "publisher_qualification_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// domain authority score, spam score, or niche-relevance determination. No
// external service (an SEO tool with real domain metrics) is called
// anywhere in this module -- see providers/null-publisher-quality-provider.ts.
// Per this agent's own rules, it evaluates only: it never contacts a
// publisher.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { PublisherQualificationAgentConfig } from "./config/publisher-qualification-agent.config.js";
import { PublisherQualificationRequestValidator } from "./validation/publisher-qualification-request-validator.js";
import type { PublisherQualityProvider } from "./types/publisher-quality-provider.types.js";
import { NullPublisherQualityProvider } from "./providers/null-publisher-quality-provider.js";
import { ProspectQualifier } from "./qualification/prospect-qualifier.js";
import type {
  PublisherQualificationRequest,
  PublisherQualificationResult,
  QualifiedProspect,
} from "./types/publisher-qualification-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real SEO tool or public-website-data API -- quality evidence comes only from the " +
  "injected PublisherQualityProvider, and this agent never contacts a publisher; it only evaluates prospects " +
  "for the Contact Intelligence Agent to act on.";

export class PublisherQualificationAgent {
  constructor(
    private readonly validator: PublisherQualificationRequestValidator,
    private readonly qualityProvider: PublisherQualityProvider,
    private readonly prospectQualifier: ProspectQualifier,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullPublisherQualityProvider
   * (no real evidence source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: PublisherQualificationAgentConfig,
    qualityProvider: PublisherQualityProvider = new NullPublisherQualityProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<PublisherQualificationAgent> {
    return new PublisherQualificationAgent(
      new PublisherQualificationRequestValidator(),
      qualityProvider,
      new ProspectQualifier(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async qualifyProspects(request: PublisherQualificationRequest): Promise<PublisherQualificationResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "publisher-qualification-agent",
        eventType: "publisher_qualification_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "publisher-qualification-agent",
      eventType: "publisher_qualification_requested",
      details: { requestId: request.id, prospectCount: request.prospecting.prospects.length },
    });

    const qualifications = await Promise.all(
      request.prospecting.prospects.map((prospect) =>
        this.prospectQualifier.qualify(this.qualityProvider, prospect, request.targetNiche),
      ),
    );

    const dataAvailable = qualifications.some((result) => result.quality !== null);
    const qualifiedProspects: QualifiedProspect[] = qualifications.map((result) => result.qualified);
    const approvedProspects = qualifiedProspects.filter((prospect) => prospect.decision === "approved");
    const rejectedProspects = qualifiedProspects.filter((prospect) => prospect.decision === "rejected");

    if (this.validator.looksLowConfidence(approvedProspects, rejectedProspects, dataAvailable)) {
      const approved = await this.escalateLowConfidence(request, rejectedProspects.length);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "publisher-qualification-agent",
          eventType: "publisher_qualification_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with zero approved prospects.",
          },
        });
        throw new Error(
          "Publisher qualification request was rejected by human review because no prospects were approved.",
        );
      }
    }

    const limitations: string[] = [...request.prospecting.limitations, OUT_OF_SCOPE_LIMITATION];
    if (!dataAvailable) {
      limitations.push(
        `No publisher quality data provider is configured (using "${this.qualityProvider.name}"); no prospect ` +
          "could be approved without real quality evidence.",
      );
    }
    if (!request.userInstructions) {
      limitations.push("No additional user instructions were supplied; qualification reflects the stated campaign requirements only.");
    }

    const result: PublisherQualificationResult = {
      requestId: request.id,
      dataAvailable,
      approvedProspects,
      rejectedProspects,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "publisher-qualification-agent",
      eventType: "publisher_qualification_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        approvedCount: approvedProspects.length,
        rejectedCount: rejectedProspects.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: PublisherQualificationRequest, rejectedCount: number): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Publisher qualification request "${request.id}" evaluated ${rejectedCount} real prospect(s) against ` +
        "real evidence and approved none of them. GLOBAL_RULES.md requires human confirmation before " +
        "forwarding an empty approved list to the Contact Intelligence Agent.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with zero approved prospects",
          score: 0,
          rationale: "Approving continues the pipeline with an empty approved list, as evaluated.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "publisher-qualification-agent",
      eventType: "publisher_qualification_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, rejectedCount },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "publisher-qualification-agent",
      eventType: "publisher_qualification_escalation_resolved",
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
