// PRODUCTION ROUTING FIX (2026-08-15): a real client-production request
// combining audit + strategy + remediation + approval + execution +
// deployment + verification + reporting in ONE message ("Audit this
// website, identify the SEO problems, create the strategy, fix every
// problem ADASOS can actually remediate, ask for approval before production
// changes, execute the approved fixes, deploy them, verify the live
// results, and give me the final client report.") was scoring ~0.23 against
// every individual specialist (none of them is a good surface-keyword match
// for a request this broad), landing below the auto-assign threshold, and
// then being silently auto-resolved to the closest specialist anyway
// (Website Audit Agent) by the web app's non-interactive approval channel
// (see web/src/server/backend/approval.ts) -- which correctly, honestly
// reported that it doesn't own repository connection, remediation
// execution, approval, deployment, or live verification, and the turn
// ended there. The specialist agent behaved correctly; the router was
// wrong to ever let a genuinely multi-stage, multi-capability request reach
// ordinary single-specialist scoring in the first place.
//
// This module classifies a task's TEXT into one of six intents based on
// which SEO-workflow STAGES it mentions -- audit, strategy, remediation,
// approval, execution, deployment, verification, reporting -- and, for
// intents that require the Boss Agent's own end-to-end ownership (spanning
// more than one stage, or explicitly naming a validation/onboarding
// workflow), reports that so task-router.ts can route the whole task to
// Boss instead of any single specialist. Deliberately NOT a single-keyword
// check: a message that merely contains the word "audit" or "SEO" is not,
// by itself, enough to classify as anything beyond AUDIT_ONLY/ADVISORY_ONLY
// -- only a genuine COMBINATION of distinct stages (or an explicit
// production/workflow-validation phrase) elevates a task to Boss ownership.
// Same deterministic, phrase-based, explainable-audit-trail discipline as
// capability-classifier.ts and boss-agent-meta-request-detector.ts -- no ML,
// no embeddings, every classification traceable to real matched text.
//
// Deliberately does NOT special-case the literal phrase "client-production
// validation" or any other single exact prompt -- CLIENT_PRODUCTION_VALIDATION
// is reached the same way every other intent is, via real stage/phrase
// combinations any future client request could independently trigger.

export type TaskIntent = "audit_only" | "advisory_only" | "audit_and_remediate" | "end_to_end_seo" | "remediation_only" | "client_production_validation";

/** Intents that require the Boss Agent's own end-to-end ownership rather than a single specialist assignment -- see this file's header and Agents/BossAgent.md's own orchestration authority. */
const ORCHESTRATED_INTENTS: ReadonlySet<TaskIntent> = new Set(["audit_and_remediate", "end_to_end_seo", "remediation_only", "client_production_validation"]);

export function isOrchestratedIntent(intent: TaskIntent | undefined): boolean {
  return intent !== undefined && ORCHESTRATED_INTENTS.has(intent);
}

/** Deliberately broader than capability-classifier.ts's technical-implementation triggers (those are narrowly technical-noun-based, e.g. "robots.txt"/"LCP") -- this needs to catch generic "audit this website"/"diagnose the problems" framing too, not just specific technical terms. */
const AUDIT_PHRASES: readonly string[] = [
  "audit this website",
  "audit my website",
  "audit the website",
  "audit this site",
  "audit my site",
  "audit the site",
  "run an audit",
  "run a full audit",
  "diagnose the problem",
  "diagnose the problems",
  "diagnose the issue",
  "diagnose the issues",
  "identify the seo problems",
  "identify the problems",
  "identify the issues",
  "find the seo problems",
  "find the problems",
  "find the issues",
  "check the website",
  "check my website",
  "check the site",
  "check my site",
  "check it",
  "find the important",
  "crawl the website",
  "crawl the site",
  "technical seo audit",
  "seo audit",
  "website audit",
  "site audit",
];

/** Broader than capability-classifier.ts's seo-strategy triggers ("seo strategy"/"seo roadmap" only) -- catches the imperative framing a real client message uses ("create the strategy") without an "SEO"/"roadmap" qualifier. */
const STRATEGY_PHRASES: readonly string[] = [
  "create the strategy",
  "create a strategy",
  "build the strategy",
  "build a strategy",
  "develop the strategy",
  "develop a strategy",
  "seo strategy",
  "seo roadmap",
  "prioritization",
  "business alignment",
  "remediation strategy",
  "remediation plan",
];

/** Broader than capability-classifier.ts's TECHNICAL_REMEDIATION_PHRASES (verb+"the"+specific-noun pairs) -- catches looser real phrasing like "fix every problem"/"fix all the problems" without requiring the exact "the issues"/"the problems" wording, plus explicit "remediate"/"remediation". */
const REMEDIATE_PHRASES: readonly string[] = [
  "fix every problem",
  "fix all problems",
  "fix all the problems",
  "fix what you can",
  "fix what adasos can",
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
  "correct the errors",
  "correct the issues",
  "remediate",
  "remediation",
];

const APPROVAL_PHRASES: readonly string[] = ["ask for approval", "before production changes", "require approval", "get approval", "approval before", "explicit approval", "human approval"];

/** Distinct from REMEDIATE_PHRASES: "fix"/"remediate" describes WHAT to change; "execute"/"apply" describes actually carrying out an already-approved change. */
const EXECUTE_PHRASES: readonly string[] = ["execute the approved", "execute the fix", "execute the fixes", "execute the change", "execute the changes", "apply the approved", "apply the fix", "apply the fixes"];

/** Broader than capability-classifier.ts's "deployment"/"deploy the" -- catches "deploy them"/"deploy it" and bare "deployment". */
const DEPLOY_PHRASES: readonly string[] = ["deploy them", "deploy it", "deploy the", "deploy this", "deployment", "push to production", "ship the fix", "ship the fixes"];

/** Broader than capability-classifier.ts's LIVE_VERIFICATION_PHRASES (narrowly "verify the fix(es)"/"confirm it worked") -- catches "verify the live results"/"confirm the live site" framing. */
const VERIFY_PHRASES: readonly string[] = [
  "verify the live",
  "verify live",
  "verify the results",
  "verify it worked",
  "verify they worked",
  "verify the fix",
  "verify the fixes",
  "confirm the live",
  "confirm it worked",
  "confirm they worked",
  "confirm the fix",
  "live verification",
];

const REPORT_PHRASES: readonly string[] = ["final report", "final client report", "client report", "give me the report", "give me a report", "summary report", "final summary"];

/** Explicit workflow/production-validation naming -- an unambiguous signal on its own, but still a real phrase match, never a hard-coded single literal prompt (see file header). */
const PRODUCTION_VALIDATION_PHRASES: readonly string[] = ["production validation", "client production validation", "client-production validation", "workflow validation", "end-to-end validation", "end to end validation", "multi-agent workflow", "multi-stage workflow"];

const CLIENT_ONBOARDING_PHRASES: readonly string[] = ["client onboarding", "onboard a new client", "onboard this client", "onboarding a new client", "onboarding this client", "new client workflow"];

/**
 * READ-ONLY / NO-REMEDIATION ROUTING FIX (2026-08-19): a real, live-tested
 * defect -- REMEDIATE_PHRASES/EXECUTE_PHRASES/DEPLOY_PHRASES are bare
 * substring matches with no awareness of negation, so a genuinely simple,
 * read-only audit request that explicitly DECLINES remediation (e.g. "...
 * report the findings, no remediation.") still matched the literal word
 * "remediation" inside "no remediation" and was misclassified
 * "audit_and_remediate" -- dragged into Boss's full orchestrated pipeline
 * instead of a simple assignment to website-audit-agent. When the message
 * explicitly declares itself read-only/no-changes, that declaration
 * overrides the bare remediate/execute/deploy substring matches below --
 * never the audit/strategy/verify/report signals, which remain valid
 * read-only-compatible stages a genuine read-only request can still ask
 * for (e.g. "read-only ... verify the results").
 */
const READ_ONLY_PHRASES: readonly string[] = [
  "read-only",
  "read only",
  "no remediation",
  "not remediation",
  "without remediation",
  "no changes needed",
  "no changes required",
  "do not fix",
  "don't fix",
  "do not remediate",
  "don't remediate",
  // EXPLICIT-ROUTING/EVIDENCE-RETRIEVAL FIX (2026-09-10): a real,
  // live-reproduced defect -- an operational, evidence-based request that
  // declares itself non-mutating in these exact, common words ("do not
  // modify the website", "do not create an approval change") did not match
  // any entry above, so isReadOnly stayed false and the request could still
  // combine with enough other stage phrases to classify as an ORCHESTRATED
  // intent -- see task-router.ts's own "EXPLICIT-ROUTING PRIORITY FIX" for
  // why that matters (a read-only + explicitly-named-agent request must be
  // able to reach isReadOnlyRequest() to ever take priority over
  // orchestration).
  "do not modify the website",
  "do not modify the site",
  "don't modify the website",
  "don't modify the site",
  "without modifying the website",
  "without modifying the site",
  "no website changes",
  "no website modification",
  "no site changes",
  "do not change the website",
  "do not change the site",
  "don't change the website",
  "don't change the site",
  "do not create an approval",
  "don't create an approval",
  "no approval change",
  "no live changes",
];

/**
 * FRESH-TASK CONTEXT ISOLATION FIX (2026-09-02): a real, live-observed defect
 * -- a genuinely NEW task's own explicit instruction to NOT reuse a previous
 * task's audit/remediation context (e.g. "Do not continue or reuse any
 * previous task, website audit, sitemap, GitHub, or remediation context.")
 * itself contains the bare phrases "website audit" (AUDIT_PHRASES) and
 * "remediation" (REMEDIATE_PHRASES). READ_ONLY_PHRASES does NOT cover this
 * "don't reuse PREVIOUS context" phrasing -- it only catches a message
 * declining remediation FOR THIS task ("no remediation"/"do not remediate"),
 * a different meaning -- so detectStages() misread the user's own isolation
 * request as real audit+remediate stage signals, classifyTaskIntent()
 * returned "audit_and_remediate", and the resulting orchestrated
 * classification fell through to the auditUrl fallback chain's
 * mostRecentAudit/connectedRepositoryLiveUrl lookups in
 * web/src/app/api/workspace/messages/route.ts -- triggering a real,
 * unrelated re-audit of a stale previous site instead of processing the
 * task's own actual (e.g. attached-file) input. When this phrasing is
 * present, suppress audit/strategy/remediate/execute/deploy/verify (the
 * stages that describe pipeline state that could have been carried over
 * from a prior task) -- but never approval/report, which remain
 * legitimate, purely forward-looking asks a genuinely fresh task can still
 * make on its own terms.
 */
// PHRASE-LIST COVERAGE FIX (2026-09-02): a real, live-confirmed regression -- a genuine fresh-task
// isolation instruction phrased as "do NOT use previous context" (no "any"/"the" article) matched NONE
// of this list's original entries (all of which required an article: "do not use ANY previous"/"do not
// use THE previous"), so isContextIsolated stayed false, the message's own "website audit"/"remediation"
// mentions (naming what NOT to reuse) were misread as real stage signals exactly as the original fix's
// own header describes, and task-router.ts's `if (taskIntent && isOrchestratedIntent(taskIntent))`
// (checked BEFORE any specialist is ever scored) short-circuited the whole request into Boss's
// orchestrated SEO pipeline -- which is also why the routing-layer's own spreadsheet-processing override
// (tag-weighted-routing-strategy.ts) never got a chance to run at all. Broadened with the missing
// article-free/synonym variants below.
const CONTEXT_ISOLATION_PHRASES: readonly string[] = [
  "do not continue or reuse",
  "do not continue any previous",
  "do not continue previous",
  "do not reuse any previous",
  "do not reuse the previous",
  "do not reuse previous",
  "don't reuse previous",
  "not reuse any previous",
  "not reuse the previous",
  "not reuse previous",
  "never reuse previous",
  "ignore any previous",
  "ignore all previous",
  "ignore the previous",
  "ignore previous",
  "ignore any prior",
  "ignore all prior",
  "ignore prior",
  "do not use any previous",
  "do not use the previous",
  "do not use previous",
  "don't use previous",
  "never use previous",
  "do not use any prior",
  "do not use prior",
  "don't use prior",
  "never use prior",
  "do not rely on previous",
  "don't rely on previous",
  "without reusing any previous",
  "without reusing the previous",
  "without reusing previous",
  "without using previous",
  "without using any previous",
  "without using prior",
  "no previous context",
  "no prior context",
  "not carry over any previous",
  "not carry over previous",
  "don't carry over any previous",
  "don't carry over previous",
  "do not carry over any previous",
  "do not carry over previous",
];

interface StageFlags {
  readonly audit: boolean;
  readonly strategy: boolean;
  readonly remediate: boolean;
  readonly approval: boolean;
  readonly execute: boolean;
  readonly deploy: boolean;
  readonly verify: boolean;
  readonly report: boolean;
  readonly productionValidation: boolean;
  readonly clientOnboarding: boolean;
}

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

/**
 * EXPLICIT-ROUTING/EVIDENCE-RETRIEVAL FIX (2026-09-10): exposes the same
 * real READ_ONLY_PHRASES check detectStages() already uses internally, so
 * task-router.ts can ask "did this task explicitly declare itself
 * non-mutating?" as its own, independent question -- see that file's own
 * "EXPLICIT-ROUTING PRIORITY FIX" for why a read-only declaration is the
 * signal that makes it safe to let an explicitly-named single specialist
 * take priority over an orchestrated multi-stage classification (a
 * read-only request can never actually need Boss's own remediate/execute/
 * deploy orchestration, by definition).
 */
export function isReadOnlyRequest(taskDescription: string): boolean {
  return includesAny(` ${taskDescription.toLowerCase()} `, READ_ONLY_PHRASES);
}

function detectStages(taskDescription: string): StageFlags {
  const lower = ` ${taskDescription.toLowerCase()} `;
  const isReadOnly = includesAny(lower, READ_ONLY_PHRASES);
  const isContextIsolated = includesAny(lower, CONTEXT_ISOLATION_PHRASES);
  return {
    audit: !isContextIsolated && includesAny(lower, AUDIT_PHRASES),
    strategy: !isContextIsolated && includesAny(lower, STRATEGY_PHRASES),
    remediate: !isReadOnly && !isContextIsolated && includesAny(lower, REMEDIATE_PHRASES),
    approval: includesAny(lower, APPROVAL_PHRASES),
    execute: !isReadOnly && !isContextIsolated && includesAny(lower, EXECUTE_PHRASES),
    deploy: !isReadOnly && !isContextIsolated && includesAny(lower, DEPLOY_PHRASES),
    verify: !isContextIsolated && includesAny(lower, VERIFY_PHRASES),
    report: includesAny(lower, REPORT_PHRASES),
    productionValidation: includesAny(lower, PRODUCTION_VALIDATION_PHRASES),
    clientOnboarding: includesAny(lower, CLIENT_ONBOARDING_PHRASES),
  };
}

/**
 * Classifies which of the six task intents `taskDescription` represents, or
 * `null` when no combination of stage signals is strong enough to classify
 * confidently -- callers should fall back to ordinary specialist scoring in
 * that case (this function never forces a classification onto genuinely
 * simple, single-capability requests).
 *
 * Ordered, most-specific-first (first match wins) -- see this file's header
 * for why a bare single stage word is never enough on its own to reach an
 * ORCHESTRATED intent; only real, multi-stage combinations do. Every
 * combination that includes `remediate`, `execute`, or `deploy` reaches an
 * ORCHESTRATED intent regardless of which other stages are also present
 * (the `(stages.remediate || hasChangeStage) && !stages.audit` rule below
 * catches all of them once `audit` is ruled out by the two rules ahead of
 * it) -- "prefer safe orchestration ownership over premature specialist
 * assignment for multi-stage requests" (this task's own requirement).
 */
export function classifyTaskIntent(taskDescription: string): TaskIntent | null {
  const stages = detectStages(taskDescription);
  // A real CHANGE to production (execute/deploy) -- distinct from `verify`,
  // which is read-only and, by itself (no audit/remediate/execute/deploy in
  // the same message), is exactly website-audit-agent's own existing real
  // live-check capability (capability-classifier.ts's LIVE_VERIFICATION_PHRASES),
  // not a signal that Boss needs to own a whole remediation workflow. A bare
  // "Verify the fixes." must keep routing there, not be swept into
  // REMEDIATION_ONLY just because "verify" is technically a pipeline stage.
  const hasChangeStage = stages.execute || stages.deploy;
  // Broader version INCLUDING verify -- legitimate for the audit/strategy
  // COMBINATION rules below, where "audit + verification" and "strategy +
  // execution" are explicitly named combinations in this task's own Routing
  // Priority requirements (verify only elevates a request when it appears
  // ALONGSIDE audit or strategy, not on its own).
  const hasExecutionStage = hasChangeStage || stages.verify;

  if (stages.productionValidation) {
    return "client_production_validation";
  }
  if (stages.clientOnboarding && (stages.execute || stages.deploy || stages.remediate)) {
    return "client_production_validation";
  }
  if (stages.audit && stages.remediate && (stages.strategy || hasExecutionStage)) {
    return "end_to_end_seo";
  }
  if (stages.audit && stages.remediate) {
    return "audit_and_remediate";
  }
  if (stages.audit && hasExecutionStage) {
    return "end_to_end_seo";
  }
  if (stages.strategy && hasExecutionStage) {
    return "end_to_end_seo";
  }
  if ((stages.remediate || hasChangeStage) && !stages.audit) {
    return "remediation_only";
  }
  if (stages.audit) {
    return "audit_only";
  }
  if (stages.strategy) {
    return "advisory_only";
  }

  return null;
}
