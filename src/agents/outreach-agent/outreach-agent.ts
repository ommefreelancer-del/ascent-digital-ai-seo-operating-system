// Outreach Agent, per Agents/outreach-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignRequirements.
//   2. Log "outreach_requested".
//   3. For every real, approved publisher from the Publisher Qualification
//      Agent's own result, look up a real, verified contact record from
//      the Contact Intelligence Agent's own result by domain. A publisher
//      with no matching verified contact is skipped -- never drafted with
//      a guessed contact method or value.
//   4. For every matched pair, draft a personalized outreach email and a
//      single follow-up message, both built from real data only (the real
//      publisher title/domain and the real, caller-supplied campaign
//      requirements text). Both are marked `requiresApproval: true` -- this
//      agent never sends anything itself, per its own rule "do not send
//      messages without human approval."
//   5. If real verified contact data was available overall but every
//      approved publisher had to be skipped, escalate to a human before
//      returning an empty draft list. When no verified contact data was
//      available at all, this is skipped -- that gap is a limitation, not
//      a judgment call being made on missing data.
//   6. Compile the result with an explicit `dataAvailable` flag, a full
//      outreach-status entry for every approved publisher (drafted or
//      skipped), and limitations carried forward from both upstream
//      results plus this agent's own scope disclaimers.
//   7. Log "outreach_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents an
// outreach target, a contact method/value, or communication history. No
// external service (an email platform, an outreach CRM) is called
// anywhere in this module -- drafting is a deterministic template over
// real data only ("Agency templates" is explicitly one of this agent's own
// listed Tools). GLOBAL_RULES.md SS9: this agent never sends a message --
// it only prepares drafts and a follow-up schedule for a human to
// authorize and send elsewhere.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { OutreachAgentConfig } from "./config/outreach-agent.config.js";
import { OutreachRequestValidator } from "./validation/outreach-request-validator.js";
import { OutreachDraftBuilder } from "./drafting/outreach-draft-builder.js";
import { FollowUpScheduleBuilder } from "./drafting/follow-up-schedule-builder.js";
import type {
  FollowUpScheduleEntry,
  OutreachDraft,
  OutreachRequest,
  OutreachResult,
  OutreachStatusEntry,
  SkippedPublisher,
} from "./types/outreach-request.types.js";
import type { ContactRecord } from "../contact-intelligence-agent/types/contact-intelligence-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";
const NO_VERIFIED_CONTACT_REASON = "No verified contact record is available for this domain.";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real email platform or outreach CRM API and never sends a message -- drafts and " +
  "the follow-up schedule come only from real, already-verified upstream data, and require human authorization " +
  "before anything is sent.";

export class OutreachAgent {
  constructor(
    private readonly validator: OutreachRequestValidator,
    private readonly draftBuilder: OutreachDraftBuilder,
    private readonly followUpScheduleBuilder: FollowUpScheduleBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: OutreachAgentConfig,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<OutreachAgent> {
    return new OutreachAgent(
      new OutreachRequestValidator(),
      new OutreachDraftBuilder(),
      new FollowUpScheduleBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async prepareOutreach(request: OutreachRequest): Promise<OutreachResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "outreach-agent",
        eventType: "outreach_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "outreach-agent",
      eventType: "outreach_requested",
      details: { requestId: request.id, approvedPublisherCount: request.publisherQualification.approvedProspects.length },
    });

    const verifiedByDomain = new Map<string, ContactRecord>(
      request.contactIntelligence.verifiedRecords.map((record) => [record.domain.toLowerCase(), record]),
    );

    const outreachDrafts: OutreachDraft[] = [];
    const followUpSchedule: FollowUpScheduleEntry[] = [];
    const outreachStatus: OutreachStatusEntry[] = [];
    const skippedPublishers: SkippedPublisher[] = [];
    const senderName = request.senderName ?? null;

    for (const publisher of request.publisherQualification.approvedProspects) {
      const contact = verifiedByDomain.get(publisher.domain.toLowerCase());
      if (!contact || !contact.contactMethod || !contact.contactValue) {
        skippedPublishers.push({
          domain: publisher.domain,
          url: publisher.url,
          title: publisher.title,
          reason: NO_VERIFIED_CONTACT_REASON,
        });
        outreachStatus.push({ domain: publisher.domain, status: "skipped-no-verified-contact", notes: NO_VERIFIED_CONTACT_REASON });
        continue;
      }

      outreachDrafts.push(
        this.draftBuilder.build(publisher, contact.contactMethod, contact.contactValue, request.campaignRequirements, senderName),
      );
      followUpSchedule.push(this.followUpScheduleBuilder.build(publisher, senderName));
      outreachStatus.push({
        domain: publisher.domain,
        status: "drafted",
        notes: `Outreach draft prepared via ${contact.contactMethod}.`,
      });
    }

    const dataAvailable = request.contactIntelligence.dataAvailable;

    if (this.validator.looksLowConfidence(outreachDrafts, skippedPublishers, dataAvailable)) {
      const approved = await this.escalateLowConfidence(request, skippedPublishers.length);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "outreach-agent",
          eventType: "outreach_rejected",
          details: { requestId: request.id, reason: "Human reviewer declined to proceed with zero outreach drafts." },
        });
        throw new Error("Outreach request was rejected by human review because no outreach drafts could be prepared.");
      }
    }

    const limitations: string[] = [
      ...request.publisherQualification.limitations,
      ...request.contactIntelligence.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];
    if (!dataAvailable) {
      limitations.push(
        "No verified contact data was available from the Contact Intelligence Agent; no outreach drafts could be prepared.",
      );
    }

    const result: OutreachResult = {
      requestId: request.id,
      dataAvailable,
      outreachDrafts,
      followUpSchedule,
      outreachStatus,
      skippedPublishers,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "outreach-agent",
      eventType: "outreach_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        draftedCount: outreachDrafts.length,
        skippedCount: skippedPublishers.length,
      },
    });

    return result;
  }

  private async escalateLowConfidence(request: OutreachRequest, skippedCount: number): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Outreach request "${request.id}" had real verified contact data available but skipped all ` +
        `${skippedCount} approved publisher(s) for lack of a matching verified contact. GLOBAL_RULES.md ` +
        "requires human confirmation before returning zero outreach drafts.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with zero outreach drafts",
          score: 0,
          rationale: "Approving continues the pipeline with an empty draft list, as evaluated.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "outreach-agent",
      eventType: "outreach_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, skippedCount },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "outreach-agent",
      eventType: "outreach_escalation_resolved",
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
