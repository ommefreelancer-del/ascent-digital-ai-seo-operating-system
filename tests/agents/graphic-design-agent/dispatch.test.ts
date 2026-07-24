import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRAPHIC_DESIGN_AGENT_ID, isGraphicDesignAssignment } from "../../../src/agents/graphic-design-agent/dispatch.js";
import { GraphicDesignAgent } from "../../../src/agents/graphic-design-agent/graphic-design-agent.js";
import { GraphicDesignRequestValidator } from "../../../src/agents/graphic-design-agent/validation/graphic-design-request-validator.js";
import { NullImageGenerationProvider } from "../../../src/agents/graphic-design-agent/providers/null-image-generation-provider.js";
import { ContentBriefDesignBriefBuilder } from "../../../src/agents/graphic-design-agent/drafting/content-brief-design-brief-builder.js";
import { FreeTextDesignBriefBuilder } from "../../../src/agents/graphic-design-agent/drafting/free-text-design-brief-builder.js";
import { ImageAssetDrafter } from "../../../src/agents/graphic-design-agent/drafting/image-asset-drafter.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { ContentStrategyResult } from "../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: GRAPHIC_DESIGN_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isGraphicDesignAssignment", () => {
  it("is true when the decision is assigned to the graphic design agent", () => {
    expect(isGraphicDesignAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isGraphicDesignAssignment(makeDecision({ assignedAgentId: "google-business-profile-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isGraphicDesignAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "graphic-design-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to GraphicDesignResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-23" });
    expect(isGraphicDesignAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request with no policy-risk signals");
      },
    };
    const agent = new GraphicDesignAgent(
      new GraphicDesignRequestValidator(),
      new NullImageGenerationProvider(),
      new ContentBriefDesignBriefBuilder(),
      new FreeTextDesignBriefBuilder(),
      new ImageAssetDrafter(),
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
      contentBriefs: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developGraphics({ id: decision.taskId, contentStrategy });

    expect(result.requestId).toBe("boss-agent-task-23");
  });
});
