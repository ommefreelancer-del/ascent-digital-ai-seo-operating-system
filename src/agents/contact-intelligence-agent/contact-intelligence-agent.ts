// Contact Intelligence Agent, per Agents/contact-intelligence-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignRequirements.
//   2. Log "contact_intelligence_requested".
//   3. For every real, approved publisher from the Publisher Qualification
//      Agent's own result, discover real public contact information
//      through the injected ContactDiscoveryProvider. With no provider
//      configured (the default), every publisher's record reports no
//      contact information found, never a guessed one.
//   4. Split records into `verifiedRecords` (the provider's own real
//      verification confirms them -- the only records the Outreach Agent
//      should act on) and `unverifiedRecords` (a real candidate exists but
//      is not verified, or nothing was found at all) -- per this agent's
//      rule, "forward verified records only".
//   5. If real discovery was attempted but nothing could be verified,
//      escalate to a human before forwarding an empty verified list to the
//      Outreach Agent. When no discovery was attempted at all, this is
//      skipped -- that gap is a limitation, not a judgment call being made
//      on missing data.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from the Publisher Qualification result
//      plus this agent's own scope disclaimers.
//   7. Log "contact_intelligence_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// contact method, email address, contact-form URL, phone number, or
// verification status. No external service (a public-website research
// tool) is called anywhere in this module -- see
// providers/null-contact-discovery-provider.ts. Per this agent's own
// rules, it never sends an email or message on the caller's behalf.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { ContactIntelligenceAgentConfig } from "./config/contact-intelligence-agent.config.js";
import { ContactIntelligenceRequestValidator } from "./validation/contact-intelligence-request-validator.js";
import type { ContactDiscoveryProvider } from "./types/contact-discovery-provider.types.js";
import { NullContactDiscoveryProvider } from "./providers/null-contact-discovery-provider.js";
import { ContactRecordBuilder } from "./contact/contact-record-builder.js";
import type {
  ContactIntelligenceRequest,
  ContactIntelligenceResult,
  ContactRecord,
} from "./types/contact-intelligence-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real public-website research tool or scraping service -- contact discovery comes " +
  "only from the injected ContactDiscoveryProvider, and this agent never sends an email or message; it only " +
  "prepares verified contact records for the Outreach Agent to act on.";

export class ContactIntelligenceAgent {
  constructor(
    private readonly validator: ContactIntelligenceRequestValidator,
    private readonly discoveryProvider: ContactDiscoveryProvider,
    private readonly contactRecordBuilder: ContactRecordBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullContactDiscoveryProvider
   * (no real discovery source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: ContactIntelligenceAgentConfig,
    discoveryProvider: ContactDiscoveryProvider = new NullContactDiscoveryProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<ContactIntelligenceAgent> {
    return new ContactIntelligenceAgent(
      new ContactIntelligenceRequestValidator(),
      discoveryProvider,
      new ContactRecordBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async gatherContacts(request: ContactIntelligenceRequest): Promise<ContactIntelligenceResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "contact-intelligence-agent",
        eventType: "contact_intelligence_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "contact-intelligence-agent",
      eventType: "contact_intelligence_requested",
      details: { requestId: request.id, approvedPublisherCount: request.publisherQualification.approvedProspects.length },
    });

    const buildResults = await Promise.all(
      request.publisherQualification.approvedProspects.map((publisher) =>
        this.contactRecordBuilder.build(this.discoveryProvider, publisher),
      ),
    );

    const dataAvailable = buildResults.some((result) => result.snapshotObtained);
    const verifiedRecords: ContactRecord[] = buildResults.filter((r) => r.isVerified).map((r) => r.record);
    const unverifiedRecords: ContactRecord[] = buildResults.filter((r) => !r.isVerified).map((r) => r.record);

    if (this.validator.looksLowConfidence(verifiedRecords, unverifiedRecords, dataAvailable)) {
      const approved = await this.escalateLowConfidence(request, unverifiedRecords.length);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "contact-intelligence-agent",
          eventType: "contact_intelligence_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with zero verified contact records.",
          },
        });
        throw new Error(
          "Contact intelligence request was rejected by human review because no contact records could be verified.",
        );
      }
    }

    const limitations: string[] = [...request.publisherQualification.limitations, OUT_OF_SCOPE_LIMITATION];
    if (!dataAvailable) {
      limitations.push(
        `No contact discovery provider is configured (using "${this.discoveryProvider.name}"); no public ` +
          "contact information could be discovered for any publisher.",
      );
    }

    const result: ContactIntelligenceResult = {
      requestId: request.id,
      dataAvailable,
      verifiedRecords,
      unverifiedRecords,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "contact-intelligence-agent",
      eventType: "contact_intelligence_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        verifiedCount: verifiedRecords.length,
        unverifiedCount: unverifiedRecords.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: ContactIntelligenceRequest, unverifiedCount: number): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Contact intelligence request "${request.id}" attempted real discovery for ${unverifiedCount} ` +
        "publisher(s) but verified none of them. GLOBAL_RULES.md requires human confirmation before " +
        "forwarding an empty verified list to the Outreach Agent.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with zero verified contact records",
          score: 0,
          rationale: "Approving continues the pipeline with an empty verified list, as discovered.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "contact-intelligence-agent",
      eventType: "contact_intelligence_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, unverifiedCount },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "contact-intelligence-agent",
      eventType: "contact_intelligence_escalation_resolved",
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
