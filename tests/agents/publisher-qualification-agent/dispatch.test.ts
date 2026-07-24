import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PUBLISHER_QUALIFICATION_AGENT_ID,
  isPublisherQualificationAssignment,
} from "../../../src/agents/publisher-qualification-agent/dispatch.js";
import { PublisherQualificationAgent } from "../../../src/agents/publisher-qualification-agent/publisher-qualification-agent.js";
import { PublisherQualificationRequestValidator } from "../../../src/agents/publisher-qualification-agent/validation/publisher-qualification-request-validator.js";
import { NullPublisherQualityProvider } from "../../../src/agents/publisher-qualification-agent/providers/null-publisher-quality-provider.js";
import { ProspectQualifier } from "../../../src/agents/publisher-qualification-agent/qualification/prospect-qualifier.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { ProspectingResult } from "../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: PUBLISHER_QUALIFICATION_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isPublisherQualificationAssignment", () => {
  it("is true when the decision is assigned to the publisher qualification agent", () => {
    expect(isPublisherQualificationAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isPublisherQualificationAssignment(makeDecision({ assignedAgentId: "prospecting-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isPublisherQualificationAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "publisher-qualification-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to PublisherQualificationResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-27" });
    expect(isPublisherQualificationAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when there are no prospects to evaluate");
      },
    };
    const agent = new PublisherQualificationAgent(
      new PublisherQualificationRequestValidator(),
      new NullPublisherQualityProvider(),
      new ProspectQualifier(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const prospecting: ProspectingResult = {
      requestId: "pr-1",
      dataAvailable: false,
      prospects: [],
      duplicatesRemoved: 0,
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.qualifyProspects({
      id: decision.taskId,
      prospecting,
      campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
      targetNiche: "plumbing",
    });

    expect(result.requestId).toBe("boss-agent-task-27");
  });
});
