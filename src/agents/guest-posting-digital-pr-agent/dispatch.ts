// Integration seam with the Boss Agent, mirroring the other specialist
// agents' dispatch.ts files. Only answers "was this routing decision
// assigned to the Guest Posting & Digital PR Agent?" against BossAgent's
// public RoutingDecision type -- no import of or change to src/boss-agent
// (locked).

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const GUEST_POSTING_DIGITAL_PR_AGENT_ID = "guest-posting-digital-pr-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isGuestPostingDigitalPrAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === GUEST_POSTING_DIGITAL_PR_AGENT_ID;
}
