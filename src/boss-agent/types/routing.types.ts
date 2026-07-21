// Output shapes produced while deciding which specialist agent a task
// belongs to. A RoutingDecision is a *decision record*, never an execution
// result — no specialist agent logic runs as part of producing one.

import type { EscalationReason } from "../../core/types/approval.types.js";

/** One specialist agent's fitness for a task, as scored by a RoutingStrategy. */
export interface RoutingCandidate {
  readonly agentId: string;
  readonly agentTitle: string;
  /** Normalized match confidence in the range [0, 1]. */
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export type RoutingStatus = "assigned" | "escalated" | "rejected";

/**
 * The result of routing a single task. Exactly one of `assigned` /
 * `escalated` / `rejected` is ever true for a given decision:
 *  - assigned: `assignedAgentId` is set, no human involvement was needed.
 *  - escalated: a human review is pending or was required; `assignedAgentId`
 *    is not set on the decision the router produces (it may be set once the
 *    EscalationHandler finalizes it as "assigned" or "rejected").
 *  - rejected: a human explicitly declined to assign this task to any agent.
 */
export interface RoutingDecision {
  readonly taskId: string;
  readonly status: RoutingStatus;
  readonly assignedAgentId?: string;
  readonly candidates: readonly RoutingCandidate[];
  readonly rationale: string;
  readonly decidedAt: string;
  /** Set by the router when `status` is "escalated"; explains why a human must decide. */
  readonly escalationReason?: EscalationReason;
}
