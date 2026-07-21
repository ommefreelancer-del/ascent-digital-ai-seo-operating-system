// Turns an "escalated" RoutingDecision into a final one by putting the
// decision in front of a human via an ApprovalChannel, and recording both the
// escalation and its resolution in the audit trail. Implements
// GLOBAL_RULES.md SS13 (Approval Escalation Policy): when the router cannot
// confidently decide, a human decides instead of the system guessing.

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../../core/governance/approval-channel.js";
import type { AuditLogger } from "../../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../../core/types/approval.types.js";
import type { RoutingDecision } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";

export class EscalationHandler {
  constructor(
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  /**
   * Resolves `decision` if it needs a human decision, otherwise returns it
   * unchanged. Never invoked for decisions that are already final.
   */
  async resolve(task: TaskInput, decision: RoutingDecision): Promise<RoutingDecision> {
    if (decision.status !== "escalated") {
      return decision;
    }

    const request: ApprovalRequest = {
      id: randomUUID(),
      reason: decision.escalationReason ?? "low_confidence_match",
      summary:
        `Task "${task.description}" (priority: ${task.priority}) could not be routed ` +
        `automatically.\nReason: ${decision.rationale}`,
      candidates: decision.candidates.map((candidate) => ({
        id: candidate.agentId,
        label: candidate.agentTitle,
        score: candidate.score,
        rationale:
          candidate.matchedTerms.length > 0
            ? `Matched terms: ${candidate.matchedTerms.join(", ")}`
            : "No matched terms.",
      })),
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "boss-agent",
      eventType: "escalation_raised",
      details: {
        taskId: task.id,
        requestId: request.id,
        reason: request.reason,
        rationale: decision.rationale,
      },
    });

    const humanDecision = await this.approvalChannel.requestDecision(request);

    await this.auditLogger.logEvent({
      actor: "boss-agent",
      eventType: "escalation_resolved",
      details: {
        taskId: task.id,
        requestId: request.id,
        outcome: humanDecision.outcome,
        selectedCandidateId: humanDecision.selectedCandidateId,
        notes: humanDecision.notes,
      },
    });

    if (humanDecision.outcome === "rejected") {
      return {
        taskId: task.id,
        status: "rejected",
        candidates: decision.candidates,
        rationale: humanDecision.notes,
        decidedAt: humanDecision.decidedAt,
      };
    }

    if (!humanDecision.selectedCandidateId) {
      // The ApprovalChannel contract requires selectedCandidateId whenever
      // outcome is "candidate_selected"; a well-behaved implementation (such
      // as CliApprovalChannel) always sets it. Guarding here rather than
      // trusting the contract keeps a misbehaving channel from silently
      // producing an invalid "assigned" decision with no assigned agent.
      throw new Error(
        `Approval channel returned "candidate_selected" without a selectedCandidateId for request "${request.id}".`,
      );
    }

    return {
      taskId: task.id,
      status: "assigned",
      assignedAgentId: humanDecision.selectedCandidateId,
      candidates: decision.candidates,
      rationale: humanDecision.notes,
      decidedAt: humanDecision.decidedAt,
    };
  }
}
