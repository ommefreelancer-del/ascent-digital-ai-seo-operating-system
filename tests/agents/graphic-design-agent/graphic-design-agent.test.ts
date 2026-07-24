import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GraphicDesignAgent } from "../../../src/agents/graphic-design-agent/graphic-design-agent.js";
import { GraphicDesignRequestValidator } from "../../../src/agents/graphic-design-agent/validation/graphic-design-request-validator.js";
import { NullImageGenerationProvider } from "../../../src/agents/graphic-design-agent/providers/null-image-generation-provider.js";
import { ContentBriefDesignBriefBuilder } from "../../../src/agents/graphic-design-agent/drafting/content-brief-design-brief-builder.js";
import { FreeTextDesignBriefBuilder } from "../../../src/agents/graphic-design-agent/drafting/free-text-design-brief-builder.js";
import { ImageAssetDrafter } from "../../../src/agents/graphic-design-agent/drafting/image-asset-drafter.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { GraphicDesignRequest } from "../../../src/agents/graphic-design-agent/types/graphic-design-request.types.js";
import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationRequest,
} from "../../../src/agents/graphic-design-agent/types/image-generation-provider.types.js";
import type { ContentBrief, ContentStrategyResult } from "../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class FixedImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "fixed-test-provider";
  async generateImage(request: ImageGenerationRequest): Promise<GeneratedImageAsset | null> {
    return { assetReference: `https://cdn.example.com/${encodeURIComponent(request.title)}.png`, format: "png" };
  }
}

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: [],
    recommendedSections: [],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: [],
    ...overrides,
  };
}

function makeContentStrategy(contentBriefs: ContentBrief[] = [makeBrief()]): ContentStrategyResult {
  return {
    requestId: "cs-1",
    topicClusters: [],
    pillarPageStrategy: [],
    internalLinkingRecommendations: [],
    editorialCalendar: [],
    contentGaps: [],
    contentBriefs,
    limitations: ["Content strategy limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<GraphicDesignRequest> = {}): GraphicDesignRequest {
  return {
    id: "req-1",
    contentStrategy: makeContentStrategy(),
    ...overrides,
  };
}

describe("GraphicDesignAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "graphic-design-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: ImageGenerationProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new GraphicDesignAgent(
      new GraphicDesignRequestValidator(),
      provider,
      new ContentBriefDesignBriefBuilder(),
      new FreeTextDesignBriefBuilder(),
      new ImageAssetDrafter(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces placeholder-asset design briefs with the default NullImageGenerationProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullImageGenerationProvider());

    const result = await agent.developGraphics(
      makeRequest({ marketingRequirements: ["Trade show flyer"], designRequests: ["A YouTube thumbnail for our launch video"] }),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.designAssets).toHaveLength(3);
    expect(result.designAssets.every((a) => !a.isGenerated)).toBe(true);
    expect(result.designAssets.every((a) => a.requiresApproval)).toBe(true);
    expect(result.designAssets.some((a) => a.graphicType === "blog-featured-image")).toBe(true);
    expect(result.designAssets.some((a) => a.graphicType === "marketing-asset")).toBe(true);
    expect(result.designAssets.some((a) => a.graphicType === "youtube-thumbnail")).toBe(true);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["graphic_design_requested", "graphic_design_completed"]);
  });

  it("carries forward the content strategy limitation and notes missing brand guidelines", async () => {
    const { agent } = buildAgent(new NullImageGenerationProvider());
    const result = await agent.developGraphics(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Content strategy limitation.",
        "No brand guidelines were supplied; design briefs use general professional styling only.",
      ]),
    );
  });

  it("marks dataAvailable true and uses real images when a real ImageGenerationProvider is configured", async () => {
    const { agent } = buildAgent(new FixedImageGenerationProvider());

    const result = await agent.developGraphics(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.designAssets[0]?.isGenerated).toBe(true);
    expect(result.designAssets[0]?.assetReference).toContain("https://cdn.example.com/");
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullImageGenerationProvider());

    await expect(agent.developGraphics(makeRequest({ designRequests: ["   "] }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["graphic_design_validation_failed"]);
  });

  it("escalates a policy-risk signal and proceeds when a human approves", async () => {
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "proceed",
      notes: "Proceed anyway.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(new NullImageGenerationProvider(), approvingDecision);

    const result = await agent.developGraphics(makeRequest({ designRequests: ["Just steal a competitor's design."] }));

    expect(result.designAssets.some((a) => a.description.includes("steal"))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual([
      "graphic_design_requested",
      "graphic_design_escalated",
      "graphic_design_escalation_resolved",
      "graphic_design_completed",
    ]);
  });

  it("rejects when a human declines the policy-risk escalation", async () => {
    const { agent, auditLogPath } = buildAgent(new NullImageGenerationProvider(), REJECTING_DECISION);

    await expect(
      agent.developGraphics(makeRequest({ designRequests: ["Just steal a competitor's design."] })),
    ).rejects.toThrow(/policy-risk signals/);

    expect(await readEventTypes(auditLogPath)).toEqual([
      "graphic_design_requested",
      "graphic_design_escalated",
      "graphic_design_escalation_resolved",
      "graphic_design_rejected",
    ]);
  });
});
