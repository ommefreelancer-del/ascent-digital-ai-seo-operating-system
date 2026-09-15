// Output shapes produced while deciding which specialist agent a task
// belongs to. A RoutingDecision is a *decision record*, never an execution
// result — no specialist agent logic runs as part of producing one.

import type { EscalationReason } from "../../core/types/approval.types.js";
import type { TaskIntent } from "../routing/task-intent-classifier.js";

/** One specialist agent's fitness for a task, as scored by a RoutingStrategy. */
export interface RoutingCandidate {
  readonly agentId: string;
  readonly agentTitle: string;
  /** Normalized match confidence in the range [0, 1]. */
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

type RoutingStatus = "assigned" | "escalated" | "rejected" | "boss_retained" | "orchestrated" | "human_approval_gate";

/**
 * The result of routing a single task.
 *  - assigned: `assignedAgentId` is set to a real specialist agent, no human
 *    involvement was needed.
 *  - escalated: a human review is pending or was required; `assignedAgentId`
 *    is not set on the decision the router produces (it may be set once the
 *    EscalationHandler finalizes it as "assigned" or "rejected").
 *  - rejected: a human explicitly declined to assign this task to any agent.
 *  - boss_retained: the task requires the Boss Agent's own orchestration
 *    authority (classifying/decomposing tasks, routing, capability-registry
 *    inspection, tool/access gating, execution/rejection-state control,
 *    QA/correction coordination, final synthesis -- see Agents/BossAgent.md's
 *    own Capabilities section) and is never delegated to a specialist agent,
 *    which has no access to that machinery. `assignedAgentId` is never set
 *    for this status -- Boss Agent itself is structurally excluded from the
 *    routable registry (see registry/agent-registry.ts's BOSS_AGENT_SPEC_ID),
 *    so there is no agent id to assign to; the decision itself IS the record
 *    that Boss retained ownership. Distinct from "escalated": this is a
 *    confident, decisive outcome, not one that needs human review.
 *  - orchestrated (PRODUCTION ROUTING FIX, 2026-08-15): a real, multi-stage
 *    SEO workflow (audit + strategy + remediation + execution + deployment +
 *    verification + reporting, in any orchestration-requiring combination --
 *    see task-intent-classifier.ts's own header for the real production
 *    defect this fixes) that the Boss Agent owns end-to-end rather than
 *    delegating to any single specialist. Distinct from "boss_retained",
 *    which is specifically for requests ABOUT the Boss Agent's own routing
 *    machinery (a meta-request) -- "orchestrated" is for real SEO/technical
 *    work the Boss Agent drives through its existing specialist-dispatch and
 *    remediation pipeline. `assignedAgentId` is never set for this status,
 *    for the same structural reason as "boss_retained".
 *  - human_approval_gate (HUMAN APPROVAL GATE ROUTING FIX, 2026-08-19): a
 *    request explicitly about the Human Approval Gate itself (checking/
 *    testing/inspecting pending approval state) -- see
 *    human-approval-gate-intent-detector.ts's own header for the real
 *    production defect this fixes (such a request was being classified
 *    "end_to_end_seo" and dragged into a full audit-first pipeline, since
 *    the gate's real logic in web/src/server/backend/remediation.ts was
 *    only ever reachable as a middle stage of that fixed sequence). Checked
 *    BEFORE the "orchestrated" short-circuit so it always takes precedence
 *    for genuinely gate-scoped requests. `assignedAgentId` is never set,
 *    for the same structural reason as "boss_retained"/"orchestrated" --
 *    the gate's real logic is dispatched directly by the web layer, not by
 *    any specialist agent.
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
  /**
   * The real, classified task-workflow intent (see task-intent-classifier.ts)
   * -- persisted on every decision this router produces, regardless of
   * status, so the original client objective survives every downstream
   * specialist handoff (this task's own "no handoff may discard the
   * original intent" requirement). `undefined` when no confident
   * classification was made (an ordinary, single-capability request).
   */
  readonly taskIntent?: TaskIntent | undefined;
}
