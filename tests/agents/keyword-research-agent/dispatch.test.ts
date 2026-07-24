import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KEYWORD_RESEARCH_AGENT_ID,
  isKeywordResearchAssignment,
} from "../../../src/agents/keyword-research-agent/dispatch.js";
import { KeywordResearchAgent } from "../../../src/agents/keyword-research-agent/keyword-research-agent.js";
import { KeywordRequestValidator } from "../../../src/agents/keyword-research-agent/validation/keyword-request-validator.js";
import { SearchIntentClassifier } from "../../../src/agents/keyword-research-agent/intent/search-intent-classifier.js";
import { TopicClusterBuilder } from "../../../src/agents/keyword-research-agent/clustering/topic-cluster-builder.js";
import { NullKeywordDataProvider } from "../../../src/agents/keyword-research-agent/providers/null-keyword-data-provider.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: KEYWORD_RESEARCH_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isKeywordResearchAssignment", () => {
  it("is true when the decision is assigned to the keyword research agent", () => {
    expect(isKeywordResearchAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isKeywordResearchAssignment(makeDecision({ assignedAgentId: "outreach-agent" }))).toBe(false);
  });

  it("is false when the decision was escalated rather than assigned", () => {
    expect(
      isKeywordResearchAssignment({
        taskId: "task-1",
        status: "escalated",
        candidates: [],
        rationale: "Ambiguous.",
        decidedAt: new Date().toISOString(),
        escalationReason: "ambiguous_match",
      }),
    ).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isKeywordResearchAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "keyword-research-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to KeywordResearchResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-42" });
    expect(isKeywordResearchAssignment(decision)).toBe(true);

    // Constructing the actual KeywordResearchRequest from richer context is
    // the caller's responsibility (see dispatch.ts) -- this test proves the
    // one thing the integration seam guarantees: the task id correlates
    // end-to-end from routing through to the research result and its audit
    // trail.
    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called for a clean request");
      },
    };
    const agent = new KeywordResearchAgent(
      new KeywordRequestValidator(),
      new SearchIntentClassifier(),
      new TopicClusterBuilder(),
      new NullKeywordDataProvider(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const result = await agent.researchKeywords({
      id: decision.taskId,
      businessObjective: "Improve rankings for the routed task.",
      seedKeywords: ["plumber near me"],
    });

    expect(result.requestId).toBe("boss-agent-task-42");
  });
});
