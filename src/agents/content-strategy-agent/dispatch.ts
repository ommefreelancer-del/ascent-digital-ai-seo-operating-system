// Integration seam with the Boss Agent, mirroring
// src/agents/keyword-research-agent/dispatch.ts. Only answers "was this
// routing decision assigned to the Content Strategy Agent?" against
// BossAgent's public RoutingDecision type -- no import of or change to
// src/boss-agent (locked), and this agent does not depend on it either.

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const CONTENT_STRATEGY_AGENT_ID = "content-strategy-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isContentStrategyAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === CONTENT_STRATEGY_AGENT_ID;
}
