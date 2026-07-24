import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTACT_INTELLIGENCE_AGENT_ID,
  isContactIntelligenceAssignment,
} from "../../../src/agents/contact-intelligence-agent/dispatch.js";
import { ContactIntelligenceAgent } from "../../../src/agents/contact-intelligence-agent/contact-intelligence-agent.js";
import { ContactIntelligenceRequestValidator } from "../../../src/agents/contact-intelligence-agent/validation/contact-intelligence-request-validator.js";
import { NullContactDiscoveryProvider } from "../../../src/agents/contact-intelligence-agent/providers/null-contact-discovery-provider.js";
import { ContactRecordBuilder } from "../../../src/agents/contact-intelligence-agent/contact/contact-record-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { PublisherQualificationResult } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: CONTACT_INTELLIGENCE_AGENT_ID,
    candidates: [],
    rationale: "Matched.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("isContactIntelligenceAssignment", () => {
  it("is true when the decision is assigned to the contact intelligence agent", () => {
    expect(isContactIntelligenceAssignment(makeDecision())).toBe(true);
  });

  it("is false when assigned to a different agent", () => {
    expect(isContactIntelligenceAssignment(makeDecision({ assignedAgentId: "publisher-qualification-agent" }))).toBe(false);
  });

  it("is false when the decision was rejected", () => {
    expect(
      isContactIntelligenceAssignment({
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
    dir = await mkdtemp(join(tmpdir(), "contact-intelligence-dispatch-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the same id from RoutingDecision.taskId through to ContactIntelligenceResult.requestId", async () => {
    const decision = makeDecision({ taskId: "boss-agent-task-29" });
    expect(isContactIntelligenceAssignment(decision)).toBe(true);

    const approvalChannel: ApprovalChannel = {
      requestDecision: async () => {
        throw new Error("should not be called when there are no approved publishers to evaluate");
      },
    };
    const agent = new ContactIntelligenceAgent(
      new ContactIntelligenceRequestValidator(),
      new NullContactDiscoveryProvider(),
      new ContactRecordBuilder(),
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

    const result = await agent.gatherContacts({
      id: decision.taskId,
      publisherQualification,
      campaignRequirements: "Find contacts for approved guest-post publishers.",
    });

    expect(result.requestId).toBe("boss-agent-task-29");
  });
});
