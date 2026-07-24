// Integration seam with the Boss Agent, mirroring the other specialist
// agents' dispatch.ts files. Only answers "was this routing decision
// assigned to the Web Development Agent?" against BossAgent's public
// RoutingDecision type -- no import of or change to src/boss-agent (locked).

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const WEB_DEVELOPMENT_AGENT_ID = "web-development-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isWebDevelopmentAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === WEB_DEVELOPMENT_AGENT_ID;
}
