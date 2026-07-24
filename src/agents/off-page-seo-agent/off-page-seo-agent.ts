// Off-Page SEO Agent, per Agents/off-page-seo-agent.md.
//
// Workflow:
//   1. Validate the request: non-empty url/businessObjective, and that
//      websiteAudit (when known) agrees on which page it describes -- a
//      genuine mismatch throws rather than being silently reconciled.
//   2. Log "off_page_seo_requested".
//   3. Fetch real backlink data through the injected BacklinkDataProvider
//      for our own url, and for every competitor with a known url from the
//      supplied CompetitorIntelligenceResult. With no provider configured
//      (the default), this always resolves to `null` -- domain authority,
//      referring-domain counts, and toxicity flags are never fabricated to
//      fill the gap.
//   4. If the provider's own toxicity analysis flags any referring domain,
//      escalate to a human before surfacing it as a disavow-review
//      candidate -- disavowing a legitimate link by mistake can itself harm
//      the site's authority.
//   5. Build referring-domain-growth and toxic-backlink insights from
//      whatever real data was returned (empty/null when unavailable), plus
//      competitor authority gaps from the real domain authority figures on
//      both sides, then derive opportunities and prioritized recommendations
//      from those real insights.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from every upstream result plus this
//      agent's own scope disclaimers.
//   7. Log "off_page_seo_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents a
// domain authority score, referring-domain count, or toxicity flag. No
// external API (Ahrefs, SEMrush, Majestic, Moz) is called anywhere in this
// module -- see providers/null-backlink-data-provider.ts.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { OffPageSeoAgentConfig } from "./config/off-page-seo-agent.config.js";
import { OffPageSeoRequestValidator } from "./validation/off-page-seo-request-validator.js";
import type { BacklinkDataProvider, BacklinkProfile } from "./types/backlink-data-provider.types.js";
import { NullBacklinkDataProvider } from "./providers/null-backlink-data-provider.js";
import { ReferringDomainGrowthBuilder } from "./synthesis/referring-domain-growth-builder.js";
import { ToxicBacklinkInsightBuilder } from "./synthesis/toxic-backlink-insight-builder.js";
import { AuthorityGapBuilder } from "./synthesis/authority-gap-builder.js";
import { OffPageOpportunityBuilder } from "./synthesis/off-page-opportunity-builder.js";
import { OffPageRecommendationBuilder } from "./synthesis/off-page-recommendation-builder.js";
import type { OffPageSeoRequest, OffPageSeoResult } from "./types/off-page-seo-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Ahrefs, SEMrush, Majestic, Moz, Google Search Console, or any other external " +
  "backlink API -- all backlink data comes only from the injected BacklinkDataProvider, supplied by the caller.";

export class OffPageSeoAgent {
  constructor(
    private readonly validator: OffPageSeoRequestValidator,
    private readonly dataProvider: BacklinkDataProvider,
    private readonly referringDomainGrowthBuilder: ReferringDomainGrowthBuilder,
    private readonly toxicBacklinkInsightBuilder: ToxicBacklinkInsightBuilder,
    private readonly authorityGapBuilder: AuthorityGapBuilder,
    private readonly opportunityBuilder: OffPageOpportunityBuilder,
    private readonly recommendationBuilder: OffPageRecommendationBuilder,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullBacklinkDataProvider
   * (no real data source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: OffPageSeoAgentConfig,
    dataProvider: BacklinkDataProvider = new NullBacklinkDataProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<OffPageSeoAgent> {
    return new OffPageSeoAgent(
      new OffPageSeoRequestValidator(),
      dataProvider,
      new ReferringDomainGrowthBuilder(),
      new ToxicBacklinkInsightBuilder(),
      new AuthorityGapBuilder(),
      new OffPageOpportunityBuilder(),
      new OffPageRecommendationBuilder(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developOffPageStrategy(request: OffPageSeoRequest): Promise<OffPageSeoResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "off-page-seo-agent",
        eventType: "off_page_seo_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "off-page-seo-agent",
      eventType: "off_page_seo_requested",
      details: { requestId: request.id, url: request.url },
    });

    const ourProfile = await this.dataProvider.fetchBacklinkProfile({ url: request.url });
    const competitorProfiles = await this.fetchCompetitorProfiles(request);

    const referringDomainGrowth = this.referringDomainGrowthBuilder.build(ourProfile);
    const toxicBacklinks = this.toxicBacklinkInsightBuilder.build(ourProfile);

    const policyRiskSignals = this.validator.findPolicyRiskSignals(toxicBacklinks);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "off-page-seo-agent",
          eventType: "off_page_seo_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing toxic-backlink signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error("Off-page SEO request was rejected by human review due to flagged toxic backlinks.");
      }
    }

    const competitorAuthorityGaps = this.authorityGapBuilder.build(
      ourProfile,
      request.competitorIntelligence.competitorGapAnalysis,
      competitorProfiles,
    );
    const opportunities = this.opportunityBuilder.build(
      referringDomainGrowth,
      competitorAuthorityGaps,
      request.businessObjective,
    );
    const recommendations = this.recommendationBuilder.build(
      referringDomainGrowth,
      competitorAuthorityGaps,
      toxicBacklinks,
      request.businessObjective,
    );

    const dataAvailable = ourProfile !== null;
    const limitations = this.buildLimitations(request, dataAvailable, competitorProfiles);

    const result: OffPageSeoResult = {
      requestId: request.id,
      url: request.url,
      dataAvailable,
      referringDomainGrowth,
      toxicBacklinks,
      competitorAuthorityGaps,
      opportunities,
      recommendations,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "off-page-seo-agent",
      eventType: "off_page_seo_completed",
      details: {
        requestId: request.id,
        dataAvailable,
        opportunityCount: opportunities.length,
        recommendationCount: recommendations.length,
        toxicBacklinkCount: toxicBacklinks.length,
      },
    });

    return result;
  }

  private async fetchCompetitorProfiles(request: OffPageSeoRequest): Promise<Map<string, BacklinkProfile | null>> {
    const profiles = new Map<string, BacklinkProfile | null>();
    for (const gap of request.competitorIntelligence.competitorGapAnalysis) {
      if (!gap.competitorUrl) {
        profiles.set(gap.competitorId, null);
        continue;
      }
      profiles.set(gap.competitorId, await this.dataProvider.fetchBacklinkProfile({ url: gap.competitorUrl }));
    }
    return profiles;
  }

  private buildLimitations(
    request: OffPageSeoRequest,
    dataAvailable: boolean,
    competitorProfiles: ReadonlyMap<string, BacklinkProfile | null>,
  ): string[] {
    const limitations: string[] = [
      ...request.websiteAudit.limitations,
      ...request.competitorIntelligence.limitations,
      OUT_OF_SCOPE_LIMITATION,
    ];

    if (!dataAvailable) {
      limitations.push(
        `No backlink data provider is configured (using "${this.dataProvider.name}"); domain authority, ` +
          "referring-domain counts, and toxicity flags are all unavailable for our own site.",
      );
    }

    const competitorsWithoutData = Array.from(competitorProfiles.values()).filter((profile) => profile === null).length;
    if (competitorsWithoutData > 0) {
      limitations.push(
        `${competitorsWithoutData} of ${competitorProfiles.size} competitor(s) have no backlink data available ` +
          "(no known url, or the provider returned nothing); their authority gap is reported as unknown.",
      );
    }

    return limitations;
  }

  private async escalatePolicyRisk(request: OffPageSeoRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Off-page SEO request "${request.id}" has real toxicity flag(s) from the backlink data provider: ` +
        `${signals.join(", ")}. GLOBAL_RULES.md requires human approval before surfacing these as disavow ` +
        "candidates, since disavowing a legitimate link by mistake can itself harm the site's authority.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed and surface the flagged referring domain(s) for human-reviewed disavow consideration",
          score: 0,
          rationale: "Approving continues off-page analysis and includes the flagged domains in the result.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "off-page-seo-agent",
      eventType: "off_page_seo_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "off-page-seo-agent",
      eventType: "off_page_seo_escalation_resolved",
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
