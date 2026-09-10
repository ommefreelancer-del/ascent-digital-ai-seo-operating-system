// Fixes the routing defect exposed by real, repeated production testing: a
// technical/orchestration task ("Fix the portfolio site's robots.txt,
// sitemap.xml, HTTP security headers, and LCP diagnosis, and fix the Boss
// Agent routing behavior...") was reaching seo-content-agent with score 1.00
// purely from surface-term overlap (tag-weighted-routing-strategy.ts's
// hasContentAuthoringIntent forces the content agent's score to the maximum
// whenever an authoring VERB and content NOUN co-occur anywhere in the task
// text, with no check that the agent actually has the capability the task
// needs) -- Keyword Research, SEO Strategy, and On-Page SEO were rejected
// for the same reason before SEO Content was even tried, exposing that
// nothing in the routing pipeline gates on real capability/tool access at
// all; keyword overlap was the ONLY signal.
//
// This module adds that missing, HARD gate: before scoring, TaskRouter (see
// ./task-router.ts) derives which capability classes a task genuinely
// requires, and any candidate that lacks a required capability is excluded
// from the candidate pool entirely -- never merely score-penalized, so a
// keyword/tag match can never rescue an ineligible candidate the way the
// content-authoring override currently can.
//
// Detection is deterministic, phrase-based substring matching -- the same
// discipline already proven in this codebase (tag-weighted-routing-strategy.ts's
// own hasContentAuthoringIntent requires a VERB+NOUN pair, never a bare
// word; conversation-language-manager's BossAgentMetaRequestDetector uses
// the identical trigger-phrase approach for meta-request detection). This
// module is boss-agent-internal and does not import
// BossAgentMetaRequestDetector (conversation-language-manager depends on
// boss-agent's tokenize(), not the other way around -- reversing that would
// invert an existing, deliberate dependency direction), but reuses the same
// proven orchestration trigger vocabulary.
//
// Three classes are used as a HARD GATE: "technical-implementation",
// "technical-remediation", and "orchestration" -- see each's own comments
// below for why. The other four classes (content-authoring, keyword-research,
// seo-strategy, on-page-seo) are classified for observability/follow-up
// continuity decisions (see web/src/server/backend/follow-up-routing.ts) but
// are NOT gated on, since disqualifying candidates by *presence* of the
// wrong ordinary-SEO class would re-introduce the same keyword-fragility
// this fix removes; real ordinary-SEO routing continues to rely on the
// existing scoring strategy, unchanged.
//
// AUDIT vs. REMEDIATION (2026-08-14 follow-up): a real production incident
// showed "Audit my website." -> "Now fix the issues you found." being
// silently re-routed back to website-audit-agent by a follow-up-continuity
// override (web/src/server/backend/follow-up-routing.ts) that only checked
// context-continuity words ("evidence", "findings", "review", ...), never
// whether the requested ACTION had changed. website-audit-agent's own real
// Tools/Capabilities are diagnostic-only (live crawler, robots.txt/sitemap.xml
// checker, Lighthouse, HTTP header inspector -- it can find and characterize
// issues, never write or deploy a fix for them); "technical-implementation"
// was already scoped to exactly that diagnostic capability. "Fix the
// issues"/"fix the robots.txt" is a fundamentally different capability --
// repository/file/CMS write access -- that NEITHER website-audit-agent nor
// technical-seo-agent has any real evidence of. "technical-remediation" is
// the new, separate, correctly-scoped class for that: see
// isCandidateEligibleFor's own comment for which real agents (grounded in
// their own Agents/*.md Tools sections, never invented) actually have it.
//
// CAPABILITY-REGISTRY VS. REAL EXECUTION (2026-08-14 client-workflow pass):
// a real client test proved that gating "technical-remediation" eligibility
// on web-development-agent.md merely LISTING "Visual Studio Code"/"GitHub" in
// its Tools section was a capability fiction. The Boss Agent selected
// web-development-agent for a remediation task, but the actual response
// (generateSpecialistReply() -- see web/src/server/backend/specialist-ai.ts)
// is Claude role-playing that spec's text with NO real tool call behind it,
// so it correctly, honestly told the user it cannot browse URLs, execute
// against a real GitHub repo, or push commits/deployments -- because it
// genuinely can't; no such integration exists anywhere in this codebase.
// Investigated (2026-08-14): web/src/app/api/workspace/messages/route.ts's
// own dispatch chain special-cases exactly two agents with real tool
// execution -- website-audit-agent (runFullAudit(), a real crawl/Lighthouse
// pipeline) and seo-content-agent (runContentGenerationPipeline(), a real
// multi-agent LLM pipeline) -- every OTHER assigned agent, including
// web-development-agent AND website-management-agent, falls through to the
// generic Claude-role-play branch with zero real tool invocation.
// website-management-agent.md's WordPress claim is not fabricated -- a real,
// tested WordPress REST API client genuinely exists (web/src/server/wordpress.ts,
// exercised by 42 real tests) -- but it is only wired to the standalone
// /api/integrations/wordpress/* content-publishing routes, never to the chat
// dispatch path in route.ts, so it is equally unreachable from a routed chat
// task today. Per Rule 4 ("DECLARED CAPABILITY = REAL TOOL = REAL BINDING =
// REAL PERMISSION = REAL EXECUTION" -- and "If the capability is not
// executable: REMOVE it from eligibility... do NOT fix the mismatch by
// adding a fake capability declaration"), technical-remediation eligibility
// is CORRECTLY, HONESTLY "always false" right now -- see
// isCandidateEligibleFor's own comment. This is not a routing bug to paper
// over; it is the true, current, disclosed state of the system: ADASOS can
// diagnose for real, but cannot yet execute a code/CMS-level fix through the
// chat routing path. Wiring website-management-agent's already-real
// WordPress client into route.ts's dispatch chain is a legitimate, scoped
// follow-up (reusing existing architecture, not a new integration) left
// undone here because it would not change the outcome for a non-WordPress
// site and is a separate, cross-cutting change from this pass's actual scope.
//
// DIAGNOSTIC-FIRST PRECEDENCE (2026-08-14): a real client message combining
// diagnosis and remediation in ONE turn -- "Please check it, find the
// important SEO and technical problems, and fix the problems you can
// actually fix." -- was being classified as technical-remediation ONLY (the
// "fix the problems" phrase triggered the mutual exclusion above), which
// would have skipped the real, working diagnostic pipeline entirely for a
// message that explicitly also asks to "check"/"find" first. Since only one
// RoutingDecision is produced per message (no task decomposition -- see this
// task's own production report for that honestly-disclosed gap), a compound
// check-then-fix message must prioritize the phase that has a REAL,
// executable tool behind it (diagnosis) so it actually runs, with a
// follow-up message picking up the remediation phase afterward -- exactly
// the two-step flow already proven end-to-end for "Audit my website." ->
// "Now fix the issues you found." See DIAGNOSTIC_FIRST_PHRASES below.

export type CapabilityClass =
  | "content-authoring"
  | "keyword-research"
  | "seo-strategy"
  | "on-page-seo"
  | "technical-implementation"
  | "technical-remediation"
  | "orchestration";

/** The classes that gate candidate eligibility -- see file header. */
export const GATING_CAPABILITIES: readonly CapabilityClass[] = ["technical-implementation", "technical-remediation", "orchestration"];

interface TriggerRule {
  readonly capability: CapabilityClass;
  readonly phrases: readonly string[];
}

// Multi-word phrases that indicate a request to REMEDIATE/FIX a technical
// issue, as opposed to diagnosing/auditing one -- see the file header's
// "AUDIT vs. REMEDIATION" note. Deliberately verb-led ("fix"/"resolve") so a
// message that only names a technical noun in passing (e.g. "the robots.txt
// checker found an issue") doesn't false-positive; every phrase pairs a
// remediation verb with either a generic finding-noun ("the issues you
// found") or a specific technical noun (robots.txt, sitemap.xml, security
// headers) -- mirrors the same VERB+NOUN discipline already proven by
// tag-weighted-routing-strategy.ts's hasContentAuthoringIntent.
const TECHNICAL_REMEDIATION_PHRASES: readonly string[] = [
  "fix the issues",
  "fix the errors",
  "fix the problems",
  "fix the bugs",
  "fix these issues",
  "fix the robots.txt",
  "fix robots.txt",
  "fix the sitemap.xml",
  "fix sitemap.xml",
  "fix the security headers",
  "fix the http headers",
  "issues you found",
  "issues found",
  "errors you found",
  "resolve the issues",
  "resolve the errors",
  "repair the issues",
  "repair the website",
  "implement the fix",
  "implement the fixes",
  "deploy the fix",
  "correct the errors",
  "correct the issues",
  "make the changes",
  "take care of the issues",
];

// See the file header's "DIAGNOSTIC-FIRST PRECEDENCE" note. Multi-word,
// deliberately narrow to genuine "inspect this fresh" framing -- not a bare
// "check"/"find" (too generic; would false-positive on unrelated requests).
// When one of these co-occurs with a TECHNICAL_REMEDIATION_PHRASES match in
// the SAME message, technical-implementation (the real, executable
// diagnostic capability) wins for this single routing decision instead of
// technical-remediation.
const DIAGNOSTIC_FIRST_PHRASES: readonly string[] = [
  "check it",
  "check my website",
  "check the website",
  "check my site",
  "check the site",
  "find the important",
  "find the problems",
  "find the issues",
  "identify the problems",
  "identify the issues",
];

// Section 10's "LIVE VERIFY" concept: a request to confirm a fix actually
// worked needs the same real, chat-dispatch-wired diagnostic tool as an
// initial audit (a fresh live check), not the generic, tool-less
// role-play fallback -- "Verify the fixes." with no other context otherwise
// matches no capability trigger at all and would fall to plain keyword
// scoring, which a real registry check found lands on web-development-agent
// (score 0.512, purely from sharing the word "fixes") instead of
// website-audit-agent (the one agent with real live-check access).
// Deliberately does NOT set technical-remediation: verifying is inspecting,
// not writing/deploying.
const LIVE_VERIFICATION_PHRASES: readonly string[] = [
  "verify the fix",
  "verify the fixes",
  "verify it worked",
  "verify they worked",
  "confirm the fix",
  "confirm it worked",
  "confirm they worked",
  "check the live website",
  "check the live site",
  "re-check the live",
  "recheck the live",
];

// Multi-word phrases only (checked via lowercased substring match, not
// tokenized single-word membership) -- deliberately avoids single generic
// words ("audit", "content", "page") that are common across many unrelated
// specs, exactly the failure mode this fix exists to eliminate. Every phrase
// here is taken directly from the task's own Rule 1 capability examples, or
// (for orchestration) from the already-proven trigger list in
// src/conversation-language-manager/routing/boss-agent-meta-request-detector.ts.
const TRIGGER_RULES: readonly TriggerRule[] = [
  {
    capability: "technical-implementation",
    phrases: [
      "robots.txt",
      "sitemap.xml",
      "security headers",
      "http headers",
      "http security",
      "live http",
      "http verification",
      "pagespeed",
      "crux",
      // Deliberately NOT "core web vitals" alone: a real production-hardening
      // finding (2026-08-13) is that performance-analytics-agent's own
      // canonical task ("Monitor our keyword rankings, organic traffic, and
      // Core Web Vitals performance trends.") legitimately mentions the term
      // while asking for MONITORING/REPORTING, not a live technical fix --
      // that agent has no crawler/Lighthouse/PageSpeed access of its own (see
      // isCandidateEligibleFor's TECHNICAL_ELIGIBILITY_PHRASES comment for
      // the matching eligibility-side finding) and would otherwise be wrongly
      // gated OUT of its own correct routing by a bare word match. The more
      // specific "LCP" (diagnosing one specific vital) and "pagespeed"/"crux"
      // (naming the actual live-measurement tools) phrases below still
      // correctly trigger the requirement for genuinely technical requests.
      " lcp", // leading space: avoid matching inside an unrelated longer token
      "deployment",
      "deploy the",
      "repository",
      "repo write",
      "code modification",
      "file modification",
      "website crawl",
      "site crawl",
      "live verification",
      "live crawl",
    ],
  },
  {
    capability: "orchestration",
    phrases: [
      // ROUTING DEFECT FIX (2026-08-31): bare "boss agent" removed -- a real,
      // reported production defect showed a genuine "full website SEO audit"
      // request that merely INSTRUCTED "Boss Agent should coordinate
      // specialist agents as needed" (describing the desired delegation
      // behavior, not asking to inspect/modify Boss's own routing machinery)
      // was classified as requiring orchestration purely from the bare
      // "boss agent" substring, and force-routed to boss_retained instead of
      // website-audit-agent. Every genuine meta-request about Boss's OWN
      // machinery already contains a MORE SPECIFIC phrase from this same
      // list (confirmed against every real "boss_retained"-expecting test in
      // this repo: "...Boss Agent's routing logic", "...routing behavior",
      // "...routing engine and candidate scoring...", "...candidate-selection
      // logic and capability registry" -- each independently matches one of
      // the phrases below without needing the bare "boss agent" name at all).
      // A bare mention of the agent's own NAME is not evidence the task is
      // ABOUT its internal machinery -- exactly the over-broad-bare-word
      // failure mode this file's own header and system-verification-intent-
      // detector.ts's header both already warn against.
      "boss router",
      "boss's routing",
      "routing logic",
      "routing behavior",
      "routing engine",
      "routing rule",
      "routing-rule",
      "orchestrator",
      "orchestration",
      "candidate selection",
      "candidate-selection",
      "candidate scoring",
      "agent selection",
      "capability registry",
      "agent registry",
      "execution-state",
      "execution state",
      "workflow state",
      "workflow logic",
    ],
  },
  {
    capability: "content-authoring",
    phrases: [
      "write a blog",
      "write an article",
      "write the article",
      "write the blog",
      "create an article",
      "draft content",
      "blog introduction",
      "landing page copy",
      "service page copy",
    ],
  },
  {
    capability: "keyword-research",
    phrases: [
      "keyword research",
      "research keywords",
      "search volume",
      "keyword difficulty",
      "keyword gap",
      "content gap",
      "commercial and informational keywords",
      "informational keywords",
    ],
  },
  {
    capability: "seo-strategy",
    phrases: ["seo strategy", "seo roadmap", "prioritization", "business alignment"],
  },
  {
    capability: "on-page-seo",
    phrases: ["title tag", "page title", "meta description", "internal linking", "on-page recommendation"],
  },
];

/**
 * Deterministic, phrase-based classification of which capability classes a
 * task's own description invokes. Never infers from agent names -- only
 * from the task text itself.
 *
 * "technical-remediation" and "technical-implementation" (diagnostic) are
 * mutually exclusive for the same message -- checked first, before the
 * generic TRIGGER_RULES loop -- exactly mirroring
 * tag-weighted-routing-strategy.ts's hasContentAuthoringIntent precedence:
 * "Now fix the robots.txt and sitemap.xml issues you found." names the same
 * technical nouns (robots.txt, sitemap.xml) a pure diagnostic request would,
 * but the "fix the ... issues" framing makes this a remediation request, not
 * a diagnostic one -- requiring BOTH classes simultaneously would demand a
 * candidate eligible for both diagnosis AND remediation tooling at once,
 * which no real agent on the roster is (they are two genuinely different,
 * separately-tooled capabilities -- see isCandidateEligibleFor), incorrectly
 * producing a capability-unavailable result for a task a real remediation
 * agent can actually handle.
 *
 * EXCEPTION -- diagnostic-first precedence (see file header): when the SAME
 * message also matches a DIAGNOSTIC_FIRST_PHRASES "inspect this fresh"
 * phrase (e.g. "check it, find the problems, and fix what you can"), that
 * ordering wins instead -- technical-implementation is HARD-REQUIRED (not
 * merely left undetected), NOT technical-remediation -- so a single compound
 * message still reaches the real, executable diagnostic pipeline rather than
 * silently skipping it. This must be an explicit requirement, not just a
 * suppression of the remediation requirement: a real check against the
 * production registry found "Please check it, find the important SEO and
 * technical problems, and fix the problems you can actually fix." scores
 * web-development-agent (0.358) fractionally ABOVE website-audit-agent
 * (0.349) on keyword overlap alone when the generic message text contains no
 * specific technical noun (robots.txt, sitemap.xml, ...) for the ordinary
 * TRIGGER_RULES loop below to catch -- without a hard requirement here, that
 * near-tie could easily route a genuinely diagnostic request to the
 * tool-less agent by chance.
 */
export function extractRequiredCapabilities(taskDescription: string): ReadonlySet<CapabilityClass> {
  const lower = ` ${taskDescription.toLowerCase()} `;
  const required = new Set<CapabilityClass>();

  const matchesRemediation = TECHNICAL_REMEDIATION_PHRASES.some((phrase) => lower.includes(phrase));
  const matchesDiagnosticFirst = DIAGNOSTIC_FIRST_PHRASES.some((phrase) => lower.includes(phrase));
  const matchesLiveVerification = LIVE_VERIFICATION_PHRASES.some((phrase) => lower.includes(phrase));
  const isRemediation = matchesRemediation && !matchesDiagnosticFirst;
  if (isRemediation) {
    required.add("technical-remediation");
  } else if (matchesDiagnosticFirst || matchesLiveVerification) {
    required.add("technical-implementation");
  }

  for (const rule of TRIGGER_RULES) {
    if (isRemediation && rule.capability === "technical-implementation") {
      continue; // mutual exclusion -- see this function's own doc comment
    }
    if (rule.phrases.some((phrase) => lower.includes(phrase))) {
      required.add(rule.capability);
    }
  }
  return required;
}

// REAL EXECUTION vs. SPEC TEXT (2026-08-14, see file header's "CAPABILITY-
// REGISTRY VS. REAL EXECUTION" note -- a real production defect this section
// fixes): technical-implementation eligibility used to be phrase-matched
// against agent spec text alone (mentions "crawl"/"lighthouse"/"robots.txt"
// etc.), which made technical-seo-agent eligible even though it has no real
// tool execution behind it -- ONLY website-audit-agent's assignment triggers
// a real tool call from the chat routing path (web/src/app/api/workspace/
// messages/route.ts's own dispatch chain calls runFullAudit() -- a real
// crawl + Lighthouse pipeline -- ONLY when assignedAgentId is exactly
// "website-audit-agent"; technical-seo-agent, like every other agent except
// website-audit-agent/seo-content-agent, falls through to a generic Claude
// role-play reply with zero real tool invocation). Eligibility for these two
// gating capabilities is therefore grounded in the REAL, WIRED dispatch
// allowlist -- the actual chain of "declared capability = real tool = real
// binding = real execution" -- rather than spec-text phrase matching, which
// proved to be only a proxy that can (and did) diverge from ground truth.
//
// technical-remediation's real, chat-dispatch-reachable allowlist for
// SPECIALIST agents is EMPTY, and stays that way even after the 2026-08-15
// routing fix described below: web-development-agent's spec lists "Visual
// Studio Code"/"GitHub", and website-management-agent's spec lists a real,
// tested WordPress REST API client (web/src/server/wordpress.ts, 42 passing
// tests) -- but NEITHER is wired into route.ts's dispatch chain, so a
// chat-routed task assigned to either produces the same generic, tool-less
// Claude role-play as any other unspecialized agent. This is the true,
// current, disclosed state of the system (Rule 4: "If the capability is not
// executable: REMOVE it from eligibility... do NOT fix the mismatch by
// adding a fake capability declaration") -- not a gap in this check. Wiring
// website-management-agent's already-real WordPress client into route.ts's
// dispatch chain is a legitimate, separate follow-up (reusing existing
// architecture, not a new integration), left undone here since it is out of
// this pass's proven scope
//
// WHO OWNS IT INSTEAD (2026-08-15 routing fix): a real, tested, end-to-end
// remediation execution pipeline was since built for the two supported
// remediation types (missing robots.txt, mismatched canonical <link> --
// src/boss-agent/remediation/*.ts + web/src/server/github.ts's
// GitHubRepositoryAdapter) -- but it is owned by the BOSS AGENT directly
// (real approval lifecycle, execution, deployment, live verification, all
// Boss-orchestrated), never delegated to a specialist, exactly like
// "orchestration" capability itself. See task-router.ts's own intent
// classification (task-intent-classifier.ts) for where a task requiring
// technical-remediation now resolves to Boss ownership ("orchestrated"
// status) instead of the "capability_unavailable" outcome this section's
// specialist-eligibility check alone would otherwise still produce.
// (the acceptance workflow's own target site is not WordPress-managed).
const TECHNICAL_IMPLEMENTATION_REAL_DISPATCH_AGENT_IDS: ReadonlySet<string> = new Set(["website-audit-agent"]);
const TECHNICAL_REMEDIATION_REAL_DISPATCH_AGENT_IDS: ReadonlySet<string> = new Set([]);

/**
 * True if `agentId` has REAL, chat-dispatch-reachable execution for
 * `capability` -- see this section's own "REAL EXECUTION vs. SPEC TEXT"
 * comment for what "real" means here and why spec-text phrase matching was
 * replaced for the two capabilities that require it.
 *
 * `orchestration` is always false for every candidate: the Boss Agent's own
 * spec is structurally excluded from the routable registry (see
 * registry/agent-registry.ts's BOSS_AGENT_SPEC_ID), so no specialist agent
 * has ever declared "Boss routing engine access" as a real tool -- this is
 * not a gap in this check, it is the real, current state of the roster
 * (Rule 6.B: "if a required capability does NOT exist, do not fake a
 * route").
 *
 * `agentToolsAndCapabilities` is intentionally unused for the two
 * dispatch-gated capabilities (kept in the signature for backward
 * compatibility with every existing call site and test that passes real
 * spec content) -- eligibility for those two is no longer a function of spec
 * text at all, precisely because spec text proved to be an unreliable proxy
 * for real execution (see above).
 */
export function isCandidateEligibleFor(capability: CapabilityClass, agentId: string, agentToolsAndCapabilities: readonly string[]): boolean {
  void agentToolsAndCapabilities;
  if (capability === "orchestration") {
    return false;
  }
  if (capability === "technical-implementation") {
    return TECHNICAL_IMPLEMENTATION_REAL_DISPATCH_AGENT_IDS.has(agentId);
  }
  if (capability === "technical-remediation") {
    return TECHNICAL_REMEDIATION_REAL_DISPATCH_AGENT_IDS.has(agentId);
  }
  // The four ordinary-SEO classes are never gated on (see file header) --
  // eligibility is irrelevant for them, but return true rather than false so
  // a future caller that mistakenly gates on one of these doesn't silently
  // exclude every candidate. Unlike the two dispatch-gated capabilities
  // above, a real tool call isn't what makes these useful -- the specialist
  // agent's own LLM-generated output (content, keyword lists, on-page
  // recommendations) IS the real, intended deliverable for these classes.
  return true;
}
