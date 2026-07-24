import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTENT_STRATEGY_AGENT_ID,
  isContentStrategyAssignment,
} from "../../../src/agents/content-strategy-agent/dispatch.js";
import { ContentStrategyAgent } from "../../../src/agents/content-strategy-agent/content-strategy-agent.js";
import { ContentStrategyRequestValidator } from "../../../src/agents/content-strategy-agent/validation/content-strategy-request-validator.js";
import { ContentTopicClusterBuilder } from "../../../src/agents/content-strategy-agent/clustering/content-topic-cluster-builder.js";
import { PillarStrategyBuilder } from "../../../src/agents/content-strategy-agent/planning/pillar-strategy-builder.js";
import { InternalLinkingRecommender } from "../../../src/agents/content-strategy-agent/planning/internal-linking-recommender.js";
import { EditorialCalendarScheduler } from "../../../src/agents/content-strategy-agent/planning/editorial-calendar-scheduler.js";
import { ContentGapAnalyzer } from "../../../src/agents/content-strategy-agent/planning/content-gap-analyzer.js";
import { ContentBriefBuilder } from "../../../src/agents/content-strategy-agent/planning/content-brief-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { KeywordResearchResult } from "../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: CONTENT_STRATEGY_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isContentStrategyAssignment", () => {
  it("is true when the decision is assigned to the content strategy agent", () => {
    expect(isContentStrategyAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isContentStrategyAssignment(makeDecision({ assignedAgentId: "keyword-research-agent" }))).toBe(
      false,
    );
  });

  it("is false when the decision was escalated rather than assigned", () => {
    expect(
      isContentStrategyAssignment({
        taskId: "task-1",
        status: "escalated",
        candidates: [],
        rationale: "Ambiguous.",
        decidedAt: new Date().toISOString(),
        escalationReason: "ambiguous_match",
      }),
    ).toBe(false);
  });
});

describe("integration: a Boss Agent routing decision can be traced through to a real result", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "content-strategy-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ContentStrategyResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-99" });
    expect(isContentStrategyAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request");
      },
    };
    const agent = new ContentStrategyAgent(
      new ContentStrategyRequestValidator(),
      new ContentTopicClusterBuilder(),
      new PillarStrategyBuilder(),
      new InternalLinkingRecommender(),
      new EditorialCalendarScheduler(),
      new ContentGapAnalyzer(),
      new ContentBriefBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const keywordResearch: KeywordResearchResult = {
      requestId: "kw-1",
      classifiedKeywords: [{ keyword: "plumber", intent: "informational", intentRationale: "x", metrics: null }],
      topicClusters: [{ label: "plumber", keywords: ["plumber"] }],
      metricsAvailable: false,
      limitations: [],
      rankingDisclaimer: "No guarantee.",
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.developStrategy({
      id: decision.taskId,
      businessObjective: "Improve rankings for the routed task.",
      keywordResearch,
      calendarStartDate: "2026-01-01T00:00:00.000Z",
    });

    expect(result.requestId).toBe("boss-agent-task-99");
  });
});
