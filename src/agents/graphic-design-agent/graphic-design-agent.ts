// Graphic Design Agent, per Agents/graphic-design-agent.md.
//
// Workflow:
//   1. Validate the request: none of marketingRequirements/
//      websiteRequirements/designRequests may contain a blank entry.
//   2. Log "graphic_design_requested".
//   3. Scan for asset-licensing policy-risk signals (stolen assets, copying
//      a competitor's assets, unlicensed assets, using assets without
//      permission). If found, escalate to a human via the same
//      ApprovalChannel/AuditLogger primitives every other agent here uses
//      -- per this agent's own rule, "use original or properly licensed
//      assets."
//   4. Build design briefs from real sources only: the Content Strategy
//      Agent's own already-computed ContentBrief objects (one
//      blog-featured-image brief per planned content piece), and the
//      caller's real marketing requirements, website requirements, and
//      ad-hoc design requests (the last classified into a graphic type by
//      real keyword signals in its own text). Nothing is fabricated.
//   5. Draft each brief's image through the injected
//      ImageGenerationProvider (a bracketed placeholder instruction when no
//      provider is configured or generation is unavailable). Every asset is
//      marked `requiresApproval: true` -- this agent never publishes
//      anything itself, in this build or any future one.
//   6. Compile the result with an explicit `dataAvailable` flag and
//      limitations carried forward from the Content Strategy result plus
//      this agent's own scope disclaimers.
//   7. Log "graphic_design_completed" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this agent never invents what a
// design request contains or produces a real image without a real
// provider. No external service (Canva, Adobe Photoshop/Illustrator, Figma,
// Photopea, an image-generation API) is called anywhere in this module --
// see providers/null-image-generation-provider.ts.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { GraphicDesignAgentConfig } from "./config/graphic-design-agent.config.js";
import { GraphicDesignRequestValidator } from "./validation/graphic-design-request-validator.js";
import type { ImageGenerationProvider } from "./types/image-generation-provider.types.js";
import { NullImageGenerationProvider } from "./providers/null-image-generation-provider.js";
import { ContentBriefDesignBriefBuilder } from "./drafting/content-brief-design-brief-builder.js";
import { FreeTextDesignBriefBuilder } from "./drafting/free-text-design-brief-builder.js";
import { classifyDesignRequest } from "./drafting/design-request-classifier.js";
import { ImageAssetDrafter } from "./drafting/image-asset-drafter.js";
import type { DesignAsset, GraphicDesignRequest, GraphicDesignResult } from "./types/graphic-design-request.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

const OUT_OF_SCOPE_LIMITATION =
  "This agent never calls Canva, Adobe Photoshop, Adobe Illustrator, Figma, Photopea, or any other external " +
  "design or image-generation service -- assets, if any, come only from the injected ImageGenerationProvider, " +
  "supplied by the caller. This agent never publishes or uploads a graphic itself; every asset requires human " +
  "authorization before use.";

export class GraphicDesignAgent {
  constructor(
    private readonly validator: GraphicDesignRequestValidator,
    private readonly imageGenerationProvider: ImageGenerationProvider,
    private readonly contentBriefDesignBriefBuilder: ContentBriefDesignBriefBuilder,
    private readonly freeTextDesignBriefBuilder: FreeTextDesignBriefBuilder,
    private readonly imageAssetDrafter: ImageAssetDrafter,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Wires the production implementation. Defaults to NullImageGenerationProvider
   * (no real generation source configured) and the interactive CLI approval
   * channel, matching how the other specialist agents are wired.
   */
  static async create(
    config: GraphicDesignAgentConfig,
    imageGenerationProvider: ImageGenerationProvider = new NullImageGenerationProvider(),
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
  ): Promise<GraphicDesignAgent> {
    return new GraphicDesignAgent(
      new GraphicDesignRequestValidator(),
      imageGenerationProvider,
      new ContentBriefDesignBriefBuilder(),
      new FreeTextDesignBriefBuilder(),
      new ImageAssetDrafter(),
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async developGraphics(request: GraphicDesignRequest): Promise<GraphicDesignResult> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "graphic-design-agent",
        eventType: "graphic_design_validation_failed",
        details: { requestId: request.id, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "graphic-design-agent",
      eventType: "graphic_design_requested",
      details: { requestId: request.id, contentBriefCount: request.contentStrategy.contentBriefs.length },
    });

    const policyRiskSignals = this.validator.findPolicyRiskSignals(request);
    if (policyRiskSignals.length > 0) {
      const approved = await this.escalatePolicyRisk(request, policyRiskSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "graphic-design-agent",
          eventType: "graphic_design_rejected",
          details: {
            requestId: request.id,
            reason: "Human reviewer declined to proceed with a request containing policy-risk signals.",
            signals: policyRiskSignals,
          },
        });
        throw new Error("Graphic design request was rejected by human review due to policy-risk signals.");
      }
    }

    const brandGuidelines = request.brandGuidelines ?? null;
    const drafts = [
      ...this.contentBriefDesignBriefBuilder.build(request.contentStrategy.contentBriefs, brandGuidelines),
      ...this.freeTextDesignBriefBuilder.build(
        request.marketingRequirements ?? [],
        "marketing-requirement",
        () => "marketing-asset",
        brandGuidelines,
      ),
      ...this.freeTextDesignBriefBuilder.build(
        request.websiteRequirements ?? [],
        "website-requirement",
        () => "website-graphic",
        brandGuidelines,
      ),
      ...this.freeTextDesignBriefBuilder.build(
        request.designRequests ?? [],
        "design-request",
        classifyDesignRequest,
        brandGuidelines,
      ),
    ];
    const designAssets: DesignAsset[] = await Promise.all(
      drafts.map((draft) => this.imageAssetDrafter.draftAsset(this.imageGenerationProvider, draft)),
    );

    const dataAvailable = designAssets.some((asset) => asset.isGenerated);
    const limitations = this.buildLimitations(request, dataAvailable);

    const result: GraphicDesignResult = {
      requestId: request.id,
      dataAvailable,
      designAssets,
      limitations,
      decidedAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "graphic-design-agent",
      eventType: "graphic_design_completed",
      details: { requestId: request.id, dataAvailable, designAssetCount: designAssets.length },
    });

    return result;
  }

  private buildLimitations(request: GraphicDesignRequest, dataAvailable: boolean): string[] {
    const limitations: string[] = [...request.contentStrategy.limitations, OUT_OF_SCOPE_LIMITATION];

    if (!request.brandGuidelines) {
      limitations.push("No brand guidelines were supplied; design briefs use general professional styling only.");
    }
    if (!dataAvailable) {
      limitations.push(
        `No image generation provider is configured (using "${this.imageGenerationProvider.name}"); every ` +
          "asset reference is a bracketed placeholder instruction, not a real, publication-ready graphic.",
      );
    }

    return limitations;
  }

  private async escalatePolicyRisk(request: GraphicDesignRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "policy_risk",
      summary:
        `Graphic design request "${request.id}" contains term(s) associated with unlicensed or misappropriated ` +
        `creative assets: ${signals.join(", ")}. GLOBAL_RULES.md requires human approval before proceeding.`,
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed with this request despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues graphic design drafting for every supplied brief.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "graphic-design-agent",
      eventType: "graphic_design_escalated",
      details: { requestId: request.id, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "graphic-design-agent",
      eventType: "graphic_design_escalation_resolved",
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
