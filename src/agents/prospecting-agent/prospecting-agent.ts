// Prospecting Agent, per Agents/prospecting-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty campaignRequirements/targetNiche/
//      targetCountry/targetLanguage.
//   2. Log "prospecting_requested".
//   3. Discover real prospect candidates through the injected
//      ProspectDiscoveryProvider. With no provider configured (the
//      default), this always resolves to `null` -- no candidate is ever
//      fabricated to fill the gap.
//   4. Remove duplicate real candidates by domain, then build the final
//      prospect list: category is the provider's own real classification,
//      confidence is a deterministic mapping from the provider's own real
//      relevance score.
//   5. If a real provider ran but the resulting evidence is thin (zero
//      prospects, or every prospect scored low confidence), escalate to a
//      human before forwarding a weak list to the Publisher Qualification
//      Agent. When no provider is configured at all, this is skipped --
//      that gap is a limitation, not a judgment call being made on thin
//      data.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations.
//   7. Log "prospecting_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// prospect website, its category, or its confidence level. No external
// service (a search engine, an SEO tool, a business directory) is called
// anywhere in this module -- see providers/null-prospect-discovery-provider.ts.
// Per this agent's own rules, it performs discovery only: it never
// contacts a publisher and never negotiates.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { ProspectingAgentConfig } from "./config/prospecting-agent.config.js";
import { ProspectingRequestValidator } from "./validation/prospecting-request-validator.js";
import type { ProspectDiscoveryProvider } from "./types/prospect-discovery-provider.types.js";
import { NullProspectDiscoveryProvider } from "./providers/null-prospect-discovery-provider.js";
import { ProspectDeduplicator } from "./processing/prospect-deduplicator.js";
import { ProspectBuilder } from "./processing/prospect-builder.js";
import type { ProspectingRequest, ProspectingResult } from "./types/prospecting-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls a real search engine, SEO tool, or business directory API -- discovery comes only " +
  "from the injected ProspectDiscoveryProvider, and this agent never contacts a publisher or negotiates; it " +
  "only discovers and categorizes prospects for the Publisher Qualification Agent to review.";

export class ProspectingAgent {
  constructor(
    private readonly validator: ProspectingRequestValidator,
    private readonly discoveryProvider: ProspectDiscoveryProvider,
    private readonly deduplicator: ProspectDeduplicator,
    private readonly prospectBuilder: ProspectBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullProspectDiscoveryProvider
   * (no real discovery source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: ProspectingAgentConfig,
    discoveryProvider: ProspectDiscoveryProvider = new NullProspectDiscoveryProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<ProspectingAgent> {
    return new ProspectingAgent(
      new ProspectingRequestValidator(),
      discoveryProvider,
      new ProspectDeduplicator(),
      new ProspectBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async discoverProspects(request: ProspectingRequest): Promise<ProspectingResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "prospecting-agent",
        eventType: "prospecting_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "prospecting-agent",
      eventType: "prospecting_requested",
      details: { requestId: request.id, targetNiche: request.targetNiche, targetCountry: request.targetCountry },
    });

    const snapshot = await this.discoveryProvider.discoverProspects({
      campaignRequirements: request.campaignRequirements,
      targetNiche: request.targetNiche,
      targetCountry: request.targetCountry,
      targetLanguage: request.targetLanguage,
      ...(request.userInstructions !== undefined && { userInstructions: request.userInstructions }),
    });

    const dataAvailable = snapshot !== null;
    const { deduped, duplicatesRemoved } = this.deduplicator.dedupe(snapshot?.candidates ?? []);
    const prospects = this.prospectBuilder.build(deduped);

    if (this.validator.looksLowConfidence(prospects, dataAvailable)) {
      const approved = await this.escalateLowConfidence(request, prospects.length);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "prospecting-agent",
          eventType: "prospecting_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a thin or empty prospect list.",
          },
        });
        throw new Error(
          "Prospecting request was rejected by human review because the discovered prospect list was empty " +
            "or entirely low-confidence.",
        );
      }
    }

    const limitations: string[] = [OUT_OF_SCOPE_LIMITATION];
    if (!dataAvailable) {
      limitations.push(
        `No prospect discovery provider is configured (using "${this.discoveryProvider.name}"); no prospects ` +
          "could be discovered for this campaign.",
      );
    }
    if (!request.userInstructions) {
      limitations.push("No additional user instructions were supplied; discovery reflects the stated campaign requirements only.");
    }

    const result: ProspectingResult = {
      requestId: request.id,
      dataAvailable,
      prospects,
      duplicatesRemoved,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "prospecting-agent",
      eventType: "prospecting_completed",
      details: { requestId: request.id, dataAvailable, prospectCount: prospects.length, duplicatesRemoved },
    });

    return result;
  }

  private async escalateLowConfidence(request: ProspectingRequest, prospectCount: number): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "low_confidence_match",
      summary:
        `Prospecting request "${request.id}" produced ${prospectCount === 0 ? "zero real prospects" : "only low-confidence real prospects"} ` +
        "after discovery. GLOBAL_RULES.md requires human confirmation before forwarding this to the " +
        "Publisher Qualification Agent.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed and forward the current prospect list as-is",
          score: 0,
          rationale: "Approving continues the pipeline using only the real prospects found so far.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "prospecting-agent",
      eventType: "prospecting_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, prospectCount },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "prospecting-agent",
      eventType: "prospecting_escalation_resolved",
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
