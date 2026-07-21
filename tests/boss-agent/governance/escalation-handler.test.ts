import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision, ApprovalRequest } from "../../../src/core/types/approval.types.js";
import { EscalationHandler } from "../../../src/boss-agent/governance/escalation-handler.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";
import type { TaskInput } from "../../../src/boss-agent/types/task.types.js";

const TASK: TaskInput = { id: "task-1", description: "Improve rankings", priority: "high" };

const ESCALATED_DECISION: RoutingDecision = {
  taskId: "task-1",
  status: "escalated",
  candidates: [
    { agentId: "agent-a", agentTitle: "Agent A", score: 0.4, matchedTerms: ["rankings"] },
    { agentId: "agent-b", agentTitle: "Agent B", score: 0.35, matchedTerms: ["improve"] },
  ],
  rationale: "Below threshold.",
  decidedAt: new Date().toISOString(),
  escalationReason: "low_confidence_match",
};

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

describe("EscalationHandler", () => {
  let dir: string;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "boss-agent-escalation-"));
    auditLogger = new AuditLogger(join(dir, "audit-log.jsonl"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a non-escalated decision unchanged, without consulting the approval channel", async () => {
    const assignedDecision: RoutingDecision = {
      taskId: "task-1",
      status: "assigned",
      assignedAgentId: "agent-a",
      candidates: [],
      rationale: "Auto-assigned.",
      decidedAt: new Date().toISOString(),
    };
    let called = false;
    const channel: ApprovalChannel = {
      requestDecision: async () => {
        called = true;
        throw new Error("should not be called");
      },
    };
    const handler = new EscalationHandler(channel, auditLogger);

    const result = await handler.resolve(TASK, assignedDecision);

    expect(result).toBe(assignedDecision);
    expect(called).toBe(false);
  });

  it("maps a candidate_selected human decision into an assigned RoutingDecision", async () => {
    const humanDecision: ApprovalDecision = {
      requestId: "req-1",
      outcome: "candidate_selected",
      selectedCandidateId: "agent-b",
      notes: "Agent B is the better fit here.",
      decidedAt: new Date().toISOString(),
    };
    const handler = new EscalationHandler(makeApprovalChannel(humanDecision), auditLogger);

    const result = await handler.resolve(TASK, ESCALATED_DECISION);

    expect(result.status).toBe("assigned");
    expect(result.assignedAgentId).toBe("agent-b");
    expect(result.rationale).toBe("Agent B is the better fit here.");
  });

  it("maps a rejected human decision into a rejected RoutingDecision", async () => {
    const humanDecision: ApprovalDecision = {
      requestId: "req-1",
      outcome: "rejected",
      notes: "Not a task we handle yet.",
      decidedAt: new Date().toISOString(),
    };
    const handler = new EscalationHandler(makeApprovalChannel(humanDecision), auditLogger);

    const result = await handler.resolve(TASK, ESCALATED_DECISION);

    expect(result.status).toBe("rejected");
    expect(result.assignedAgentId).toBeUndefined();
    expect(result.rationale).toBe("Not a task we handle yet.");
  });

  it("passes the decision's candidates through to the approval request", async () => {
    let capturedRequest: ApprovalRequest | undefined;
    const channel: ApprovalChannel = {
      requestDecision: async (request) => {
        capturedRequest = request;
        return {
          requestId: request.id,
          outcome: "rejected",
          notes: "n/a",
          decidedAt: new Date().toISOString(),
        };
      },
    };
    const handler = new EscalationHandler(channel, auditLogger);

    await handler.resolve(TASK, ESCALATED_DECISION);

    expect(capturedRequest?.reason).toBe("low_confidence_match");
    expect(capturedRequest?.candidates.map((c) => c.id)).toEqual(["agent-a", "agent-b"]);
  });

  it("logs both an escalation_raised and an escalation_resolved audit event", async () => {
    const humanDecision: ApprovalDecision = {
      requestId: "req-1",
      outcome: "rejected",
      notes: "skip",
      decidedAt: new Date().toISOString(),
    };
    const handler = new EscalationHandler(makeApprovalChannel(humanDecision), auditLogger);

    await handler.resolve(TASK, ESCALATED_DECISION);

    const lines = (await readFile(join(dir, "audit-log.jsonl"), "utf8")).trim().split("\n");
    const eventTypes = lines.map((line) => JSON.parse(line).eventType);
    expect(eventTypes).toEqual(["escalation_raised", "escalation_resolved"]);
  });
});
