// Integration seam with the Boss Agent. Deliberately minimal: it only
// answers "was this routing decision assigned to the Keyword Research
// Agent?" against BossAgent's public RoutingDecision type -- it does not
// import or modify anything under src/boss-agent (that module is locked,
// per the prior Phase 7 review) and this agent does not depend on it either.
//
// This module intentionally does NOT auto-convert a routed TaskInput into a
// KeywordResearchRequest. TaskInput.description is a free-text task summary
// for routing purposes, not a structured list of seed keywords plus a
// business objective -- treating it as one would be presenting an
// assumption as verified input (GLOBAL_RULES.md SS1). Constructing a real
// KeywordResearchRequest (actual seed keywords, actual business objective)
// from richer task context is the calling code's responsibility.

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";

export const KEYWORD_RESEARCH_AGENT_ID = "keyword-research-agent";

/** True if `decision` was auto-assigned (or human-confirmed) to this agent. */
export function isKeywordResearchAssignment(decision: RoutingDecision): boolean {
  return decision.status === "assigned" && decision.assignedAgentId === KEYWORD_RESEARCH_AGENT_ID;
}
