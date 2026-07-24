import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROSPECTING_AGENT_ID, isProspectingAssignment } from "../../../src/agents/prospecting-agent/dispatch.js";
import { ProspectingAgent } from "../../../src/agents/prospecting-agent/prospecting-agent.js";
import { ProspectingRequestValidator } from "../../../src/agents/prospecting-agent/validation/prospecting-request-validator.js";
import { NullProspectDiscoveryProvider } from "../../../src/agents/prospecting-agent/providers/null-prospect-discovery-provider.js";
import { ProspectDeduplicator } from "../../../src/agents/prospecting-agent/processing/prospect-deduplicator.js";
import { ProspectBuilder } from "../../../src/agents/prospecting-agent/processing/prospect-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: PROSPECTING_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isProspectingAssignment", () => {
  it("is true when the decision is assigned to the prospecting agent", () => {
    expect(isProspectingAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isProspectingAssignment(makeDecision({ assignedAgentId: "graphic-design-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isProspectingAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "prospecting-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ProspectingResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-25" });
    expect(isProspectingAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when no provider is configured (no escalation for that gap)");
      },
    };
    const agent = new ProspectingAgent(
      new ProspectingRequestValidator(),
      new NullProspectDiscoveryProvider(),
      new ProspectDeduplicator(),
      new ProspectBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const result = await agent.discoverProspects({
      id: decision.taskId,
      campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
      targetNiche: "plumbing",
      targetCountry: "US",
      targetLanguage: "en",
    });

    expect(result.requestId).toBe("boss-agent-task-25");
  });
});
