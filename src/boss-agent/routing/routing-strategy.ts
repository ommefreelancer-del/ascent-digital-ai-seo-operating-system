// Extension point for how a task is scored against a candidate specialist
// agent. This build ships one deterministic implementation
// (KeywordMatchRoutingStrategy); a future strategy (e.g. LLM-assisted
// scoring) can be substituted without changing TaskRouter.

import type { AgentSpec } from "../types/agent-spec.types.js";
import type { RoutingCandidate } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";

export interface RoutingStrategy {
  readonly name: string;

  /** Scores how well `candidate` fits `task`. Must be a pure computation. */
  score(task: TaskInput, candidate: AgentSpec): RoutingCandidate;
}
