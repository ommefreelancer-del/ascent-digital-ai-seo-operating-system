import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OUTREACH_AGENT_ID, isOutreachAssignment } from "../../../src/agents/outreach-agent/dispatch.js";
import { OutreachAgent } from "../../../src/agents/outreach-agent/outreach-agent.js";
import { OutreachRequestValidator } from "../../../src/agents/outreach-agent/validation/outreach-request-validator.js";
import { OutreachDraftBuilder } from "../../../src/agents/outreach-agent/drafting/outreach-draft-builder.js";
import { FollowUpScheduleBuilder } from "../../../src/agents/outreach-agent/drafting/follow-up-schedule-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { PublisherQualificationResult } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactIntelligenceResult } from "../../../src/agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: OUTREACH_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isOutreachAssignment", () => {
  it("is true when the decision is assigned to the outreach agent", () => {
    expect(isOutreachAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isOutreachAssignment(makeDecision({ assignedAgentId: "contact-intelligence-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isOutreachAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "outreach-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to OutreachResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-31" });
    expect(isOutreachAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when there are no approved publishers to evaluate");
      },
    };
    const agent = new OutreachAgent(
      new OutreachRequestValidator(),
      new OutreachDraftBuilder(),
      new FollowUpScheduleBuilder(),
      approvalChannel,
      new AuditLogger(join(dir, "audit-log.jsonl")),
    );

    const publisherQualification: PublisherQualificationResult = {
      requestId: "pq-1",
      dataAvailable: false,
      approvedProspects: [],
      rejectedProspects: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };
    const contactIntelligence: ContactIntelligenceResult = {
      requestId: "ci-1",
      dataAvailable: false,
      verifiedRecords: [],
      unverifiedRecords: [],
      limitations: [],
      decidedAt: new Date().toISOString(),
    };

    const result = await agent.prepareOutreach({
      id: decision.taskId,
      publisherQualification,
      contactIntelligence,
      campaignRequirements: "Guest post outreach for a plumbing brand.",
    });

    expect(result.requestId).toBe("boss-agent-task-31");
  });
});
