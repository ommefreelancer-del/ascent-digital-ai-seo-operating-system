import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEO_CONTENT_AGENT_ID, isSeoContentAssignment } from "../../../src/agents/seo-content-agent/dispatch.js";
import { SeoContentAgent } from "../../../src/agents/seo-content-agent/seo-content-agent.js";
import { SeoContentRequestValidator } from "../../../src/agents/seo-content-agent/validation/seo-content-request-validator.js";
import { NullContentGenerationProvider } from "../../../src/agents/seo-content-agent/providers/null-content-generation-provider.js";
import { MetaContentBuilder } from "../../../src/agents/seo-content-agent/drafting/meta-content-builder.js";
import { FaqBuilder } from "../../../src/agents/seo-content-agent/drafting/faq-builder.js";
import { ContentSectionDrafter } from "../../../src/agents/seo-content-agent/drafting/content-section-drafter.js";
import { ContentPieceAssembler } from "../../../src/agents/seo-content-agent/drafting/content-piece-assembler.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { ContentStrategyResult } from "../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: SEO_CONTENT_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isSeoContentAssignment", () => {
  it("is true when the decision is assigned to the SEO content agent", () => {
    expect(isSeoContentAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isSeoContentAssignment(makeDecision({ assignedAgentId: "off-page-seo-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isSeoContentAssignment({
        taskId: "task-1",
        status: "rejected",
        candidates: [],
        rationale: "Declined.",
        decidedAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe("integration: a Boss Agent routing decision can be traced through to a real result", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seo-content-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to SeoContentResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-13" });
    expect(isSeoContentAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no policy-risk signals");
      },
    };
    const agent = new SeoContentAgent(
      new SeoContentRequestValidator(),
      new NullContentGenerationProvider(),
      new MetaContentBuilder(),
      new FaqBuilder(),
      new ContentSectionDrafter(),
      new ContentPieceAssembler(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const contentStrategy: ContentStrategyResult = {
      requestId: "cs-1",
      topicClusters: [],
      pillarPageStrategy: [],
      internalLinkingRecommendations: [],
      editorialCalendar: [],
      contentGaps: [],
      contentBriefs: [
        {
          title: "Emergency Plumbing Guide",
          contentType: "pillar",
          targetKeyword: "emergency plumber",
          intent: "informational",
          clusterLabel: "emergency plumber",
          relatedKeywords: [],
          recommendedSections: ["Introduction"],
          wordCountGuidance: "1,800-3,000 words.",
          internalLinks: [],
        },
      ],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const keywordResearch: KeywordResearchResult = {
      requestId: "kw-1",
      classifiedKeywords: [],
      topicClusters: [],
      metricsAvailable: false,
      limitations: [],
      rankingDisclaimer: "No guarantee.",
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developContent({
      id: decision.taskId,
      businessObjective: "Grow emergency plumbing leads.",
      contentStrategy,
      keywordResearch,
    });

    expect(result.requestId).toBe("boss-agent-task-13");
  });
});
