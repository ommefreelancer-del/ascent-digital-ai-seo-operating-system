// Integration seam with the Boss Agent, mirroring the other specialist
// agents' dispatch.ts files. Only answers "was this routing decision
// assigned to the AI CRM Agent?" against BossAgent's public RoutingDecision
// type -- no import of or change to src/boss-agent (locked).

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const AI_CRM_AGENT_ID = "ai-crm-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isAiCrmAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === AI_CRM_AGENT_ID;
}
