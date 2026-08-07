// Bug fix: a follow-up message referencing "the previous audit" (findings,
// evidence, validation, review, etc.) after Website Audit Agent completed a
// task was being answered by the Boss Agent instead of routed back to
// Website Audit Agent -- because TaskRouter scores every message purely on
// its own vocabulary against the real Agents/ corpus, with zero awareness
// of which agent handled the previous turn in this session. A short
// follow-up like "Are there any contradictions in the findings?" shares no
// distinctive vocabulary with website-audit-agent.md, so it either
// escalates to a different top-scoring agent or (if very short) never
// reaches Boss Agent routing at all.
//
// This module only detects the two real facts the override needs: whether
// the *previous* completed task in this session was Website Audit Agent
// (looked up from the real ChatMessage history in route.ts, not guessed),
// and whether the *current* message's real text contains one of the
// required follow-up terms. It never guesses either fact.

export const WEBSITE_AUDIT_AGENT_ID = "website-audit-agent";

/** Exact terms this bug fix is scoped to -- see the task's required behavior list. */
const FOLLOW_UP_TERMS: readonly string[] = [
  "previous audit",
  "previous report",
  "findings",
  "evidence",
  "validation",
  "review",
  "audit quality",
  "duplicate findings",
  "contradictions",
];

function buildFollowUpPattern(): RegExp {
  const escaped = FOLLOW_UP_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

const FOLLOW_UP_PATTERN = buildFollowUpPattern();

/** Returns the exact matched follow-up term (real, verbatim from the message), or `null` if none of the required terms are present. */
export function matchWebsiteAuditFollowUpTerm(message: string): string | null {
  return message.match(FOLLOW_UP_PATTERN)?.[0] ?? null;
}

/** True when `message` refers back to a previous Website Audit Agent task using one of the required follow-up terms. */
export function isWebsiteAuditFollowUp(message: string): boolean {
  return matchWebsiteAuditFollowUpTerm(message) !== null;
}

/** True when this session's previous completed task was handled by Website Audit Agent AND the current message is a real follow-up reference to it -- the exact condition the required routing override applies to. */
export function shouldRouteBackToWebsiteAuditAgent(previousAssignedAgentId: string | null, message: string): boolean {
  return previousAssignedAgentId === WEBSITE_AUDIT_AGENT_ID && isWebsiteAuditFollowUp(message);
}
