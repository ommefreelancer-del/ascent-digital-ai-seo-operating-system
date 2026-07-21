// Decides, for a single task, whether a specialist agent can be assigned
// automatically or whether the decision must go to a human. This is the
// "resolve conflicts between recommendations" and "escalate uncertainty
// instead of guessing" behavior required of the Boss Agent by BossAgent.md
// and GLOBAL_RULES.md SS1/SS2/SS13 — implemented as a routing *decision*
// only. No specialist agent is ever invoked here.

import type { AgentDirectory } from "../registry/agent-registry.js";
import type { RoutingDecision } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";
import type { RoutingStrategy } from "./routing-strategy.js";

export interface TaskRouterConfig {
  /** Minimum score (0-1) a top candidate must reach to be auto-assigned. */
  readonly autoAssignThreshold: number;
  /** Minimum lead (0-1) the top candidate must hold over the runner-up to avoid a tie escalation. */
  readonly tieMargin: number;
  /** How many ranked candidates to keep on the decision for human review / audit. */
  readonly maxCandidates: number;
}

export class TaskRouter {
  constructor(
    private readonly registry: AgentDirectory,
    private readonly strategy: RoutingStrategy,
    private readonly config: TaskRouterConfig,
  ) {}

  route(task: TaskInput): RoutingDecision {
    const decidedAt = new Date().toISOString();
    const ranked = this.registry
      .list()
      .map((spec) => this.strategy.score(task, spec))
      .sort((a, b) => b.score - a.score);
    const topCandidates = ranked.slice(0, this.config.maxCandidates);

    const best = ranked[0];
    if (!best || best.score <= 0) {
      return {
        taskId: task.id,
        status: "escalated",
        candidates: topCandidates,
        rationale:
          "No specialist agent's stated mission, responsibilities, inputs, or outputs matched any meaningful term in this task description.",
        decidedAt,
        escalationReason: "no_matching_candidate",
      };
    }

    const runnerUp = ranked[1];
    const leadOverRunnerUp = runnerUp ? best.score - runnerUp.score : best.score;
    const meetsThreshold = best.score >= this.config.autoAssignThreshold;
    const meetsTieMargin = leadOverRunnerUp >= this.config.tieMargin;

    if (meetsThreshold && meetsTieMargin) {
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: best.agentId,
        candidates: topCandidates,
        rationale:
          `Matched term(s) [${best.matchedTerms.join(", ")}] against "${best.agentTitle}"` +
          ` (score ${best.score.toFixed(2)}) with a clear lead over the next candidate.`,
        decidedAt,
      };
    }

    let rationale: string;
    if (!meetsThreshold) {
      rationale =
        `Best match "${best.agentTitle}" scored ${best.score.toFixed(2)}, below the ` +
        `auto-assign threshold of ${this.config.autoAssignThreshold.toFixed(2)}.`;
    } else if (runnerUp) {
      rationale =
        `Best match "${best.agentTitle}" (${best.score.toFixed(2)}) is too close to runner-up ` +
        `"${runnerUp.agentTitle}" (${runnerUp.score.toFixed(2)}) to assign automatically.`;
    } else {
      rationale =
        `Best match "${best.agentTitle}" (${best.score.toFixed(2)}) did not reach the configured ` +
        `tie margin of ${this.config.tieMargin.toFixed(2)}.`;
    }

    return {
      taskId: task.id,
      status: "escalated",
      candidates: topCandidates,
      rationale,
      decidedAt,
      escalationReason: meetsThreshold ? "ambiguous_match" : "low_confidence_match",
    };
  }
}
