// Integration seam with the Boss Agent, mirroring the other specialist
// agents' dispatch.ts files. Only answers "was this routing decision
// assigned to the On-Page SEO Agent?" against BossAgent's public
// RoutingDecision type -- no import of or change to src/boss-agent (locked).

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const ON_PAGE_SEO_AGENT_ID = "on-page-seo-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isOnPageSeoAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === ON_PAGE_SEO_AGENT_ID;
}
