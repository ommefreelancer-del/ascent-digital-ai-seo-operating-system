// Integration seam with the Boss Agent, mirroring the other specialist
// agents' dispatch.ts files. Only answers "was this routing decision
// assigned to the Google Sheets Integration Agent?" against BossAgent's
// public RoutingDecision type -- no import of or change to src/boss-agent
// (locked).

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isGoogleSheetsIntegrationAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === GOOGLE_SHEETS_INTEGRATION_AGENT_ID;
}
