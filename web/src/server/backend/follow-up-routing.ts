// Bug fix (2026-08-13): a follow-up message referencing "the previous audit"
// (findings, evidence, validation, review, etc.) after Website Audit Agent
// completed a task was being answered by the Boss Agent instead of routed
// back to Website Audit Agent -- because TaskRouter scores every message
// purely on its own vocabulary against the real Agents/ corpus, with zero
// awareness of which agent handled the previous turn in this session. A
// short follow-up like "Are there any contradictions in the findings?"
// shares no distinctive vocabulary with website-audit-agent.md, so it either
// escalates to a different top-scoring agent or (if very short) never
// reaches Boss Agent routing at all.
//
// REAL PRODUCTION REGRESSION this same override then caused (2026-08-14):
// "Audit my website." -> "Now fix the issues you found." was ALSO matched by
// this override (the follow-up terms below are deliberately broad context-
// continuity words) and silently routed back to Website Audit Agent again --
// even though "fix" requests a completely different capability
// (technical-remediation: real repo/file/CMS write access) that
// website-audit-agent's own real Tools/Capabilities never claim (it is
// diagnostic-only: live crawler, robots.txt/sitemap.xml checker, Lighthouse,
// HTTP header inspector -- it can find an issue, never fix one). The UI
// literally showed "matched term: 'evidence'" as the justification for
// re-running an audit instead of fixing anything.
//
// Root cause: CONTEXT continuity (the follow-up terms below) was being used
// as a proxy for EXECUTION-OWNERSHIP continuity, which it isn't -- a message
// can legitimately continue talking about the same audit while asking for a
// completely different action. The fix: even when a message matches a real
// context-continuity term, this override now ALSO checks whether the
// message's own real, classified capability (via
// src/boss-agent/routing/capability-classifier.ts's extractRequiredCapabilities
// -- the SAME classifier TaskRouter itself uses for fresh routing, not a
// second, competing one) has changed to something outside website-audit-agent's
// own domain (technical-remediation, on-page-seo, keyword-research,
// content-authoring, seo-strategy, or orchestration). If it has, the
// override no longer applies -- route.ts falls through to a normal, fresh
// Boss Agent routing decision, which runs full capability-first gating
// against the CURRENT message on its own terms.
//
// This module only detects the real facts the override needs: whether the
// *previous* completed task in this session was Website Audit Agent (looked
// up from the real ChatMessage history in route.ts, not guessed), whether
// the *current* message's real text contains one of the required
// context-continuity terms, and whether that message's own real action/
// intent has changed capability. It never guesses any of these.
//
// hasFollowUpActionChanged() dynamically imports the real, compiled
// capability-classifier.js from ../../../../dist/src -- the SAME frozen-
// backend boundary conversation.ts's own importBackend() crosses, and for
// the same reason: web/ never statically imports the backend's TypeScript
// source directly (that would pull the frozen backend into this app's own
// TypeScript/build graph, defeating the whole point of the dist/ boundary --
// see conversation.ts's file header). This reuses the SAME classifier
// TaskRouter itself uses for fresh routing, not a second, competing one.
//
// CASE CONTINUITY (2026-08-15, system-consistency pass): a second, real,
// confirmed production defect in this same module -- a follow-up to an
// ALREADY Boss-owned ("orchestrated") case, e.g. "show me the findings"
// after a real end_to_end_seo request, was being silently re-routed back to
// Website Audit Agent by the override above, EVEN THOUGH the fresh
// classification for that follow-up (see task-intent-classifier.ts) may
// itself already be confidently "orchestrated", or the previous case was
// already Boss-owned and nothing about this message suggests the user is
// starting something new. The root problem: this module only ever asked
// "did the PREVIOUS turn go to Website Audit Agent", never "was there an
// open BOSS-OWNED CASE this message should resume instead of being freshly
// routed at all". resolveFollowUp() below is the single, unified decision
// point for both questions -- callers (route.ts) no longer call
// shouldRouteBackToWebsiteAuditAgent() directly for the routing decision;
// they call resolveFollowUp() with the previous turn's full persisted
// snapshot (agentId, status, taskIntent -- all already stored in
// ChatMessage.status/metaJson, no new persistence added) and the fresh
// decision's own status. A confident fresh "orchestrated" classification
// always wins (Rule 1) -- Boss's own real, present-tense confidence is never
// second-guessed by a keyword heuristic. Otherwise, an open orchestrated
// case is resumed (Rule 2) unless the message is a confident, high-scoring
// assignment to a DIFFERENT specialist (a genuinely new, unrelated
// request) or clearly names a different site (see route.ts's own
// `looksLikeNewTask` check, passed in rather than duplicated here since it
// needs route.ts's own extractUrl()/seoAudit lookup). The original
// Website-Audit-Agent-specific override (Rule 3) is preserved unchanged for
// the case that motivated it originally.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchSpreadsheetOperationTerm } from "./spreadsheet-processing";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");

async function importCapabilityClassifier(): Promise<typeof import("../../../../src/boss-agent/routing/capability-classifier.js")> {
  const target = path.join(backendDist, "boss-agent", "routing", "capability-classifier.js");
  return import(/* webpackIgnore: true */ `file://${target}`);
}

export const WEBSITE_AUDIT_AGENT_ID = "website-audit-agent";

// WEBSITE AUDIT ROUTING FIX (2026-08-18): real, live reproduction found
// "Use the Website Audit Agent specifically for this validation." correctly
// resolved to a fresh, confident "assigned" decision via
// src/boss-agent/routing/explicit-agent-match.ts's deterministic tier-0 gate
// (score 1, "resolved directly... before generic specialist scoring") --
// but the request was STILL silently redirected through a stale, unrelated,
// open orchestrated content-generation-pipeline case (Keyword Research ->
// SEO Strategy -> SEO Content -> On-Page SEO in sequence), and Website
// Audit Agent never received it at all. Root cause: Rule 2 below treats the
// word "validation" as a real, generic context-continuity signal (it is one
// of FOLLOW_UP_TERMS, for a completely different, legitimate purpose --
// detecting a genuine follow-up like "review the previous validation") --
// but "validation" is ALSO the exact word this project's own standard
// explicit-agent test/validation phrasing always uses ("...to perform this
// validation."). So a fresh, maximally-confident, deterministic explicit
// assignment was being silently overridden by an incidental word match
// against an unrelated old case, in direct violation of "an explicit,
// registered agent name has highest routing priority."
// NOT the full rationale prefix alone -- task-router.ts's OWN honest
// "requested_agent_not_found" escalation rationale (see
// findUnresolvedAgentMention()) ALSO starts with 'The request explicitly
// names "', for a completely different, failed-resolution outcome. The
// distinguishing text unique to an actual SUCCESSFUL explicit match is the
// "-- resolved directly to" clause that follows it (see task-router.ts's
// own explicit-match branch) -- never present in the not-found rationale.
const EXPLICIT_AGENT_MATCH_SUCCESS_MARKER = '-- resolved directly to "';

/**
 * True when the fresh RoutingDecision was resolved via the deterministic
 * explicit-agent-name tier (task-router.ts's own explicit-match branch,
 * fed by explicit-agent-match.ts) rather than generic keyword/tag scoring
 * -- and specifically a SUCCESSFUL resolution, not the honest
 * "requested_agent_not_found" escalation, which shares the same opening
 * phrase but never this success marker. Checked via the exact, unique
 * rationale text that tier always produces -- the same real-text-matching
 * discipline this file already uses for FOLLOW_UP_TERMS/CASE_CONTINUATION_TERMS,
 * not a guess. No other routing path (including TagWeightedRoutingStrategy's
 * own contentAuthoringIntent override, which can also force score 1 but
 * always with real, non-empty matchedTerms and a different rationale shape)
 * ever produces this text.
 */
export function isExplicitAgentAssignment(freshRationale: string | undefined): boolean {
  return freshRationale?.includes(EXPLICIT_AGENT_MATCH_SUCCESS_MARKER) ?? false;
}

/** Exact terms this bug fix is scoped to -- see the task's required behavior list. Context-continuity signal ONLY -- see this file's header for why it is no longer sufficient by itself. */
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

/**
 * Capability classes that represent a DIFFERENT execution domain than
 * website-audit-agent's own (diagnose/crawl/audit). If a follow-up message
 * classifies into any of these, the requested ACTION has changed even if the
 * message also uses a context-continuity word -- see this file's header.
 * "technical-implementation" (the diagnostic class) is deliberately absent:
 * that IS website-audit-agent's own domain, so detecting it on a follow-up
 * doesn't represent a change in execution ownership.
 */
const ACTION_CHANGING_CAPABILITIES: ReadonlySet<string> = new Set([
  "technical-remediation",
  "on-page-seo",
  "keyword-research",
  "content-authoring",
  "seo-strategy",
  "orchestration",
]);

/** Returns the exact matched follow-up term (real, verbatim from the message), or `null` if none of the required terms are present. */
export function matchWebsiteAuditFollowUpTerm(message: string): string | null {
  return message.match(FOLLOW_UP_PATTERN)?.[0] ?? null;
}

/** True when `message` refers back to a previous Website Audit Agent task using one of the required follow-up terms (context-continuity signal only -- see this file's header). */
export function isWebsiteAuditFollowUp(message: string): boolean {
  return matchWebsiteAuditFollowUpTerm(message) !== null;
}

/** True when `message`'s own classified action/capability has changed to something outside website-audit-agent's diagnostic domain -- e.g. "fix the issues" (technical-remediation), "optimize the meta titles" (on-page-seo). See this file's header for the real regression this exists to catch. */
export async function hasFollowUpActionChanged(message: string): Promise<boolean> {
  const { extractRequiredCapabilities } = await importCapabilityClassifier();
  const required = extractRequiredCapabilities(message);
  for (const capability of required) {
    if (ACTION_CHANGING_CAPABILITIES.has(capability)) {
      return true;
    }
  }
  return false;
}

/**
 * True when this session's previous completed task was handled by Website
 * Audit Agent, the current message is a real context-continuity reference to
 * it, AND the message's own requested action has NOT changed to a different
 * capability domain -- the exact, now-corrected condition the required
 * routing override applies to. CONTEXT continuity alone (matching a
 * follow-up term) is no longer sufficient by itself -- see this file's
 * header for the real production regression this fixes.
 */
export async function shouldRouteBackToWebsiteAuditAgent(previousAssignedAgentId: string | null, message: string): Promise<boolean> {
  if (previousAssignedAgentId !== WEBSITE_AUDIT_AGENT_ID || !isWebsiteAuditFollowUp(message)) {
    return false;
  }
  return !(await hasFollowUpActionChanged(message));
}

// GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX (2026-09-15): a real, live-reported production defect,
// symmetric to the Website Audit Agent override above -- a genuine follow-up to a completed Google
// Sheets Integration Agent cleaning task (e.g. "Now validate this live -- run it again and confirm the
// result.") carries neither this project's own explicit-agent-name phrasing nor a spreadsheet attachment
// (hasSpreadsheetProcessingIntent() in tag-weighted-routing-strategy.ts only boosts this agent's score
// when an attachment is present), so a fresh classification can score it against a completely unrelated
// specialist purely on generic vocabulary overlap -- live-observed scoring "Website Audit Agent" at 0.44,
// below the 0.50 auto-assign threshold, and failing to route at all. The task's own real work still got
// done (route.ts's forceGoogleSheetsRevalidation dispatch bypass), but the DISPLAYED/PERSISTED routing
// decision was left wrong -- "Rejected", "Best match Website Audit Agent" -- which is what this fixes:
// resolveFollowUp() below now returns a genuine "assigned to google-sheets-integration-agent" decision
// for this exact case, the same way it already does for Website Audit Agent, so the Task Progress UI and
// persisted ChatMessage state are consistent with what actually happened.
const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";

/** Real, verbatim matched term (never a guess) -- reuses spreadsheet-processing.ts's own SPREADSHEET_OPERATION_PATTERN (the SAME broad, already-tested detector the attachment-based dispatch path uses), deliberately NOT a new, narrower phrase list -- see this file's header on why being broad here is still safe. */
export function matchGoogleSheetsIntegrationFollowUpTerm(message: string): string | null {
  return matchSpreadsheetOperationTerm(message);
}

/** True when `message` refers back to a previous Google Sheets Integration Agent cleaning task using a real spreadsheet-operation verb (read/clean/dedup/validate/compare/etc.) -- context-continuity signal only, mirroring isWebsiteAuditFollowUp()'s own role for its specialist. */
export function isGoogleSheetsIntegrationFollowUp(message: string): boolean {
  return matchGoogleSheetsIntegrationFollowUpTerm(message) !== null;
}

/** True when this session's previous completed task was handled by Google Sheets Integration Agent, the current message is a real context-continuity reference to it, AND the message's own requested action has NOT changed to a different capability domain -- exactly mirrors shouldRouteBackToWebsiteAuditAgent()'s reasoning for a different specialist's own domain (reuses the SAME hasFollowUpActionChanged() capability check -- none of ACTION_CHANGING_CAPABILITIES are things Google Sheets Integration Agent handles either, so it's directly reusable, unmodified). */
export async function shouldRouteBackToGoogleSheetsIntegration(previousAssignedAgentId: string | null, message: string): Promise<boolean> {
  if (previousAssignedAgentId !== GOOGLE_SHEETS_INTEGRATION_AGENT_ID || !isGoogleSheetsIntegrationFollowUp(message)) {
    return false;
  }
  return !(await hasFollowUpActionChanged(message));
}

// Broader than FOLLOW_UP_TERMS -- generic case-continuation phrasing, not
// specific to Website Audit Agent's own domain. See this file's header
// ("CASE CONTINUITY") for the real defect this closes: these are the exact
// example follow-ups this task's own requirements list ("show me the
// findings", "continue", "fix those issues", "what happens next?",
// "approve it", "check again", "why did it fail?").
const CASE_CONTINUATION_TERMS: readonly string[] = [
  ...FOLLOW_UP_TERMS,
  "continue",
  "what happens next",
  "what's next",
  "whats next",
  "keep going",
  "check again",
  "recheck",
  "why did it fail",
  "why did that fail",
  "why did verification fail",
  "approve it",
  "reject it",
  "run the next remediation",
  "next remediation",
];

function buildCaseContinuationPattern(): RegExp {
  const escaped = CASE_CONTINUATION_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

const CASE_CONTINUATION_PATTERN = buildCaseContinuationPattern();

/** True when `message` uses generic case-continuation language (see CASE_CONTINUATION_TERMS) -- a superset of isWebsiteAuditFollowUp(), not specific to any one specialist's domain. */
export function isCaseContinuationMessage(message: string): boolean {
  return CASE_CONTINUATION_PATTERN.test(message);
}

/** Real, persisted facts about the previous turn's routing decision -- read from ChatMessage.status/metaJson (see route.ts), never re-derived or guessed. */
export interface PreviousCaseSnapshot {
  readonly assignedAgentId: string | null;
  readonly status: string | null;
  readonly taskIntent: string | null;
}

export type FollowUpAction =
  | { readonly kind: "use_fresh_decision" }
  | { readonly kind: "resume_orchestrated_case"; readonly taskIntent: string }
  | { readonly kind: "route_back_to_website_audit"; readonly matchedTerm: string }
  | { readonly kind: "route_back_to_google_sheets_integration"; readonly matchedTerm: string };

/**
 * THE single, unified follow-up/case-continuity decision -- see this file's
 * header ("CASE CONTINUITY") for the real defect this fixes and the
 * rationale for each rule. `freshStatus` is the CURRENT message's own fresh
 * RoutingDecision.status (from sendConversationMessage(), computed BEFORE
 * this is called -- never re-scored here); `looksLikeNewTask` is a real,
 * concrete signal the caller computed (e.g. a URL for a different site
 * appears in the message) -- never guessed inside this function, since it
 * needs route.ts's own extractUrl()/seoAudit lookup to determine honestly.
 * `freshRationale` is the fresh decision's own real `rationale` string --
 * see isExplicitAgentAssignment()'s own header for the real regression
 * Rule 1.5 below fixes.
 */
export async function resolveFollowUp(
  previous: PreviousCaseSnapshot,
  freshStatus: string | undefined,
  freshRationale: string | undefined,
  message: string,
  looksLikeNewTask: boolean,
): Promise<FollowUpAction> {
  // Rule 1: a fresh, confident orchestrated classification always wins --
  // Boss's own present-tense confidence is never second-guessed by a
  // keyword heuristic, regardless of what the previous turn was.
  if (freshStatus === "orchestrated") {
    return { kind: "use_fresh_decision" };
  }

  // Rule 1.5 (WEBSITE AUDIT ROUTING FIX, 2026-08-18): a fresh, confident
  // EXPLICIT agent-name resolution wins for the same reason Rule 1 does --
  // see isExplicitAgentAssignment()'s own header for the real, live
  // production defect this fixes (an unrelated open case silently
  // swallowing an unambiguous "Use the Website Audit Agent specifically"
  // request purely because the word "validation" incidentally also matches
  // FOLLOW_UP_TERMS). Checked before Rule 2 so a deterministic, score-1
  // explicit match is never second-guessed by generic case-continuation
  // wording.
  if (freshStatus === "assigned" && isExplicitAgentAssignment(freshRationale)) {
    return { kind: "use_fresh_decision" };
  }

  // Rule 2: an open, Boss-owned case is resumed unless this message is
  // either a confident, high-scoring assignment to a genuinely different
  // specialist, or clearly names a different site -- "existing case wins;
  // create a new task only when the user clearly starts one" (this task's
  // own requirement).
  if (previous.status === "orchestrated" && previous.taskIntent && !looksLikeNewTask && (isCaseContinuationMessage(message) || freshStatus !== "assigned")) {
    return { kind: "resume_orchestrated_case", taskIntent: previous.taskIntent };
  }

  // Rule 3 (unchanged, pre-existing behavior): a genuine follow-up to a
  // completed Website Audit Agent (audit_only) task.
  if (!looksLikeNewTask && previous.assignedAgentId === WEBSITE_AUDIT_AGENT_ID && isWebsiteAuditFollowUp(message) && !(await hasFollowUpActionChanged(message))) {
    return { kind: "route_back_to_website_audit", matchedTerm: matchWebsiteAuditFollowUpTerm(message) ?? "" };
  }

  // Rule 3.5 (GOOGLE SHEETS RE-VALIDATION FOLLOW-UP FIX, 2026-09-15): symmetric to Rule 3 above -- see
  // this file's header (search "GOOGLE SHEETS RE-VALIDATION") for the real, live-reported defect this
  // closes. shouldRouteBackToGoogleSheetsIntegration() already encapsulates the previous-agent-identity
  // and action-unchanged checks; only looksLikeNewTask is applied here, matching Rule 3's own shape.
  if (!looksLikeNewTask && (await shouldRouteBackToGoogleSheetsIntegration(previous.assignedAgentId, message))) {
    return { kind: "route_back_to_google_sheets_integration", matchedTerm: matchGoogleSheetsIntegrationFollowUpTerm(message) ?? "" };
  }

  return { kind: "use_fresh_decision" };
}
