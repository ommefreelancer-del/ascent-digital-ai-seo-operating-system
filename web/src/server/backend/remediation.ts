// Web-layer glue for the real remediation execution layer
// (src/boss-agent/remediation/*.ts, compiled to dist/src/boss-agent/remediation).
// Mirrors website-audit.ts's own dynamic-import-from-dist pattern -- this
// app never statically imports the frozen backend's TypeScript source (see
// conversation.ts's own header for why). This is the seam Section 10 of the
// remediation-execution task requires: "the user-facing ADASOS application
// must be able to trigger the real remediation lifecycle" -- not an isolated
// helper chat can't reach.
//
// REAL HANDS (2026-08-14): registers the real GitHubRepositoryAdapter
// (server/github.ts) into the bridge on every call -- the adapter itself is
// always real and always registered; what determines whether a given
// workspace's remediation can actually execute is
// GitHubRepositoryAdapter.isEligibleForTask(), which does a real, live
// per-workspace connection check (see remediation-execution-bridge.ts's own
// hasRealAdapterForTask()). A workspace with no configured GitHub connection
// (the honest, current state for every workspace until a real OAuth
// connection is made via /api/integrations/github/connect) still honestly
// reaches BLOCKED -- "external authorization required" -- never a
// fabricated RESOLVED.

import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel } from "./approval";
import { GitHubRepositoryAdapter, type RootSiteProvisioningPlan } from "@/server/github";
import { db } from "@/server/db";
import { assertAuthorized } from "@/server/rbac";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

// APPROVAL LIFECYCLE FIX (2026-08-16): how long a presented approval stays
// valid (Section 7's "expiration/validity where appropriate"). Was a
// hardcoded 30 minutes -- a real, confirmed production usability defect:
// a human reviewing a real infrastructure change (create a repository,
// enable Pages) needs to actually read the plan, is not necessarily
// sitting at the keyboard synchronously, and may reasonably want to check
// with a stakeholder before clicking Approve -- 30 minutes is a
// synchronous-chat assumption, not a production human-in-the-loop one.
// Defaults to 24 HOURS -- long enough that a human can review this
// asynchronously (e.g. "review it before end of day"), short enough that
// the underlying diagnosis/evidence (a live crawl, a live Pages
// configuration check) isn't stale by the time it's acted on -- GitHub
// Pages/repository state can genuinely change within a day, so this is
// not made unbounded. Configurable via REMEDIATION_APPROVAL_TTL_HOURS
// (a positive number of hours) for deployments that need a different
// window; an invalid/non-positive value falls back to the 24h default
// rather than silently producing a zero/negative TTL.
const DEFAULT_APPROVAL_TTL_HOURS = 24;
function resolveApprovalTtlMs(): number {
  const raw = process.env.REMEDIATION_APPROVAL_TTL_HOURS;
  const hours = raw ? Number(raw) : NaN;
  const effectiveHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_APPROVAL_TTL_HOURS;
  return effectiveHours * 60 * 60 * 1000;
}
const APPROVAL_TTL_MS = resolveApprovalTtlMs();

// Real GitHub Pages deployments take real time to rebuild and serve new
// content -- confirmed via real, live acceptance runs where verification
// retried with zero delay (and, once, even a 15s delay) and didn't always
// give a genuinely successful deployment enough time to propagate --
// real-world deploy latency observed varying roughly 15-40s across
// separate real runs. 25s between each of the 3 real verification attempts
// (0s, 25s, 50s after the commit) gives a real, bounded chance to catch up
// without making a single approval action block indefinitely. This is
// still not a guarantee -- a genuinely slow deploy can still exceed this
// window, in which case the honest FAILED outcome (never a fabricated
// RESOLVED) is correct, not a bug.
const VERIFICATION_RETRY_DELAY_MS = 25 * 1000;

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

export interface RemediationRollbackDataView {
  readonly path: string;
  readonly branch: string;
  readonly previousContent: string | null;
  readonly previousSha: string | null;
}

export interface RemediationTaskView {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly findingId: string;
  readonly affectedResource: string;
  readonly evidence: string;
  readonly diagnosis: string;
  readonly requiredCapability: string;
  readonly requiredTool: string;
  readonly proposedAction: string;
  readonly approvalState: string;
  readonly executionState: string;
  readonly verificationState: string;
  readonly finalStatus: string;
  readonly failureReason: string | null;
  readonly verificationEvidence: string | null;
  readonly verificationResumeCount?: number;
  readonly maxVerificationResumes?: number;
  readonly rollbackData?: RemediationRollbackDataView | null;
  /**
   * ROOT-SITE PROVISIONING CAPABILITY (2026-08-16): present only for a task
   * whose finalStatus is/was "root_site_provisioning_required" -- the real,
   * structured plan (see GitHubRepositoryAdapter.checkRootSiteProvisioningCandidate())
   * this task's own execution is driven from. Its presence, not findingId's
   * prefix, is what routes resolveRemediationApproval()/resumeVerificationAction()
   * to the provisioning-specific execution path instead of the frozen
   * RemediationOrchestrator -- see this file's own header on why the
   * orchestrator's single-execute-call, single-repository model doesn't fit
   * a multi-step "create a repository, then configure it, then commit to
   * it" action.
   */
  readonly rootSiteProvisioning?: RootSiteProvisioningPlan | null;
}

interface RemediationModules {
  readonly verifyRobotsTxtLive: (url: string) => Promise<{ passed: boolean; httpStatus: number | null; evidence: string }>;
  readonly planRobotsTxtRemediation: (input: {
    workspaceId: string;
    siteUrl: string;
    robotsTxtFound: boolean;
    sitemapUrlsFound: number;
  }) => RemediationTaskView | null;
  readonly verifyCanonicalUrlLive: (pageUrl: string) => Promise<{ passed: boolean; currentCanonical: string | null; evidence: string }>;
  readonly planCanonicalUrlRemediation: (input: {
    workspaceId: string;
    pageUrl: string;
    canonicalMatchesPageUrl: boolean;
    currentCanonical: string | null;
  }) => RemediationTaskView | null;
  /** SITEMAP REMEDIATION CAPABILITY (2026-08-22): real, live re-fetch + parse of the deployed sitemap.xml -- see live-verifier.ts's own verifySitemapLive(). */
  readonly verifySitemapLive: (sitemapUrl: string) => Promise<{ passed: boolean; urlCount: number; evidence: string }>;
  /** SITEMAP REMEDIATION CAPABILITY (2026-08-22): see sitemap-remediation-planner.ts's own header. `crawledUrls` are real, already-crawled, successfully-fetched page URLs -- the ONLY source for sitemap entries. */
  readonly planSitemapRemediation: (input: {
    workspaceId: string;
    siteUrl: string;
    sitemapUrlsFound: number;
    crawledUrls: readonly string[];
  }) => RemediationTaskView | null;
  readonly RemediationExecutionBridge: new () => {
    hasRealAdapter(capability: string, tool: string): boolean;
    registerAdapter(adapter: GitHubRepositoryAdapter): void;
  };
  readonly RemediationOrchestrator: new (
    bridge: unknown,
    approvalChannel: unknown,
    auditLogger: unknown,
    verify?: (task: RemediationTaskView) => Promise<{ passed: boolean; evidence: string }>,
    verificationRetryDelayMs?: number,
  ) => {
    run(task: RemediationTaskView): Promise<RemediationTaskView>;
    planAndRequestApproval(task: RemediationTaskView): Promise<{ task: RemediationTaskView; approvalRequest: unknown }>;
    resumeAfterApproval(task: RemediationTaskView, decision: { approved: boolean; notes: string }): Promise<RemediationTaskView>;
    /** PRODUCTION HARDENING (2026-08-14): resumes a task genuinely left at "verification_pending" -- see remediation-orchestrator.ts's own doc comment. */
    resumeVerification(task: RemediationTaskView): Promise<RemediationTaskView>;
  };
  readonly AuditLogger: new (filePath: string) => unknown;
}

/** The findingId prefix each planner uses, in the same order candidates are tried -- see verifyTaskLive()'s own comment on why dispatch is keyed on this. */
const CANONICAL_FINDING_PREFIX = "canonical-url-mismatch:";
/** SITEMAP REMEDIATION CAPABILITY (2026-08-22): sitemap-remediation-planner.ts's own stable findingId prefix -- see planSitemapRemediation()'s construction. */
const SITEMAP_FINDING_PREFIX = "sitemap-empty:";

/**
 * Dispatches to the REAL live-verification check matching a task's own
 * remediation type -- see RemediationOrchestrator's own LiveVerifier doc
 * comment (frozen backend) for the real bug this closes: verification used
 * to always run the robots.txt check regardless of task type, so a
 * genuinely executed, deployed canonical-URL fix was reported "failed"
 * because it was checked for a "User-agent:" directive it was never
 * supposed to have. Dispatches on findingId's own prefix -- each planner's
 * stable, real identifier for its finding type (see each planner's own
 * findingId construction) -- rather than adding a redundant "kind" field to
 * RemediationTask.
 */
function verifyTaskLive(task: RemediationTaskView, modules: RemediationModules): Promise<{ passed: boolean; evidence: string }> {
  if (task.findingId.startsWith(CANONICAL_FINDING_PREFIX)) {
    return modules.verifyCanonicalUrlLive(task.affectedResource);
  }
  if (task.findingId.startsWith(SITEMAP_FINDING_PREFIX)) {
    return modules.verifySitemapLive(task.affectedResource);
  }
  return modules.verifyRobotsTxtLive(task.affectedResource);
}

function buildOrchestrator(modules: RemediationModules) {
  const bridge = new modules.RemediationExecutionBridge();
  bridge.registerAdapter(new GitHubRepositoryAdapter());
  const auditLogger = new modules.AuditLogger(path.join(backendRoot, "var", "web", "remediation", "audit-log.jsonl"));
  return new modules.RemediationOrchestrator(bridge, createWebApprovalChannel(), auditLogger, (task) => verifyTaskLive(task, modules), VERIFICATION_RETRY_DELAY_MS);
}

let modulesPromise: Promise<RemediationModules> | null = null;

async function getModules(): Promise<RemediationModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [{ verifyRobotsTxtLive, verifyCanonicalUrlLive, verifySitemapLive }, { planRobotsTxtRemediation }, { planCanonicalUrlRemediation }, { planSitemapRemediation }, { RemediationExecutionBridge }, { RemediationOrchestrator }, { AuditLogger }] = await Promise.all([
        importBackend("boss-agent/remediation/live-verifier.js"),
        importBackend("boss-agent/remediation/robots-txt-remediation-planner.js"),
        importBackend("boss-agent/remediation/canonical-url-remediation-planner.js"),
        importBackend("boss-agent/remediation/sitemap-remediation-planner.js"),
        importBackend("boss-agent/remediation/remediation-execution-bridge.js"),
        importBackend("boss-agent/remediation/remediation-orchestrator.js"),
        importBackend("core/governance/audit-logger.js"),
      ]);
      return { verifyRobotsTxtLive, planRobotsTxtRemediation, verifyCanonicalUrlLive, planCanonicalUrlRemediation, verifySitemapLive, planSitemapRemediation, RemediationExecutionBridge, RemediationOrchestrator, AuditLogger };
    })();
  }
  return modulesPromise;
}

// ============================================================
// Generic candidate-selection / eligibility preflight (2026-08-14
// issue-selection fix). See this task's own final report for the real
// incident this closes: a structurally NOT_REMEDIABLE finding (origin-root
// robots.txt on a GitHub Pages PROJECT-site connection -- see
// GitHubRepositoryAdapter.isEligibleForTask() and
// resourceIsCoveredByLiveUrl() in server/github.ts for the real, generic
// check) kept being re-offered as an approval candidate on every request.
// ============================================================

const NOT_REMEDIABLE_PREFIX = "NOT_REMEDIABLE:";

export type RemediationSelectionResult =
  | { readonly outcome: "selected"; readonly task: RemediationTaskView }
  | { readonly outcome: "blocked_no_eligible_finding"; readonly attempted: readonly RemediationTaskView[] };

/**
 * Generic, remediation-TYPE-agnostic candidate selection -- deliberately
 * NOT specific to robots.txt or any single finding kind, per this task's
 * own "must be generic enough for future remediation types" requirement.
 * Tries each real, already-planned candidate task in order (never
 * fabricates one); `attempt` is expected to run the real eligibility gate
 * (RemediationOrchestrator.planAndRequestApproval(), which already checks
 * eligibility BEFORE ever creating an approval request -- see
 * remediation-orchestrator.ts's own "APPROVAL ORDERING" comment) and return
 * its resulting task. Stops at the first candidate that reaches
 * pending_approval; every candidate that doesn't is collected in
 * `attempted` for the caller to report/persist. Two real remediation types
 * exist in this system (robots.txt, and the homepage's canonical <link>
 * tag -- see runTechnicalSeoRemediation()); this function's genericity was
 * first proven with synthetic candidates and is now also exercised for
 * real with both.
 */
export async function selectRemediableCandidate(
  candidates: readonly RemediationTaskView[],
  attempt: (candidate: RemediationTaskView) => Promise<RemediationTaskView>,
): Promise<RemediationSelectionResult> {
  const attempted: RemediationTaskView[] = [];
  for (const candidate of candidates) {
    const result = await attempt(candidate);
    // "root_site_provisioning_required" (2026-08-16) is a second real,
    // genuinely actionable stopping condition -- exactly like
    // "pending_approval", it means a real, human-decidable approval card now
    // exists for this candidate; the selection loop must stop here too,
    // never keep trying other candidates past a real approval already
    // waiting on a human.
    //
    // BUGFIX (2026-08-16): "verification_pending"/"resolved" must ALSO stop
    // the loop -- these are real, already-in-flight-or-decided outcomes
    // (surfaced by attemptCandidate()'s own existingInFlight fast-path, or
    // attemptRootSiteProvisioningCandidate()'s own idempotency fast-paths --
    // see that function's own comment) that must never be silently
    // superseded by trying a SECOND, unrelated candidate (e.g. a canonical-
    // link finding) whose own attempt might reach a real BLOCKED outcome
    // and overwrite this genuinely meaningful result in `attempted`'s last
    // slot -- confirmed via a real, live test run: an in-flight robots.txt
    // provisioning task was masked by a later canonical-candidate BLOCKED
    // result until this fix.
    if (
      result.finalStatus === "pending_approval" ||
      result.finalStatus === "root_site_provisioning_required" ||
      result.finalStatus === "verification_pending" ||
      result.finalStatus === "resolved"
    ) {
      return { outcome: "selected", task: result };
    }
    attempted.push(result);
  }
  return { outcome: "blocked_no_eligible_finding", attempted };
}

/** Rewords a real NOT_REMEDIABLE eligibility reason into this task's own required, exact phrasing -- never changes the underlying real reason, only its framing for "no eligible finding exists" vs. "this one specific thing is blocked". */
function toNoEligibleFindingTask(task: RemediationTaskView): RemediationTaskView {
  const detail = (task.failureReason ?? "").replace(new RegExp(`^${NOT_REMEDIABLE_PREFIX}\\s*`), "");
  return { ...task, failureReason: `BLOCKED — no currently remediable finding: ${detail}` };
}

type Orchestrator = ReturnType<typeof buildOrchestrator>;
/** `accountLogin` (2026-08-16) lets attemptRootSiteProvisioningCandidate()'s own idempotency fast-path key its lookup without a real GitHub network call -- see that function's own comment. */
type ConnectionRecord = { id: string; repositoryFullName: string; accountLogin: string } | null;

/**
 * PRODUCTION HARDENING (2026-08-15), Section 4: a GitHubConnection row can
 * now exist with no repository chosen yet (status "pending_repository_
 * selection", repositoryFullName null -- see server/github.ts's own
 * savePendingGitHubConnection()). That connection is real but not yet
 * usable for remediation -- attemptCandidate() below already treats "no
 * connection" as "BLOCKED, external authorization required" via the real
 * adapter's own eligibility check, so a pending-selection connection is
 * narrowed to `null` here rather than threading a nullable
 * repositoryFullName through ConnectionRecord.
 */
function toUsableConnectionRecord(connection: { id: string; repositoryFullName: string | null; accountLogin: string; status: string } | null): ConnectionRecord {
  if (!connection || connection.status !== "active" || !connection.repositoryFullName) {
    return null;
  }
  return { id: connection.id, repositoryFullName: connection.repositoryFullName, accountLogin: connection.accountLogin };
}

// ============================================================
// ROOT-SITE PROVISIONING CAPABILITY (2026-08-16) -- "FINAL ROOT-CAUSE FIX":
// turns the previously permanent NOT_REMEDIABLE "no root-site repository
// exists" outcome into a real, approval-gated, executable path: diagnose ->
// ROOT_SITE_PROVISIONING_REQUIRED -> explicit approval -> create the
// repository -> configure GitHub Pages -> write root robots.txt -> real
// deployment wait -> live verification -> RESOLVED.
//
// Deliberately NOT routed through the frozen RemediationOrchestrator's
// planAndRequestApproval()/resumeAfterApproval() -- that class's model is
// ONE atomic bridge.execute() call against the ALREADY-connected
// repository, verified/rolled-back against that SAME repository
// (GitHubRepositoryAdapter.rollback() reads the connection's own, currently
// selected repositoryFullName -- see its own doc comment). Provisioning is
// structurally different: it targets a repository that does not exist yet
// at approval time, and its own execution is multiple, ordered real GitHub
// operations (create, then configure, then commit), not one. Forcing this
// through the orchestrator's single-execute-call contract would mean either
// weakening rollback()'s own real-repository targeting (a working, tested,
// production safety mechanism for the EXISTING remediation types) or
// building a second bridge/orchestrator pair -- both worse than what this
// does instead: reuse every other real piece of the SAME infrastructure --
// the SAME RemediationApproval table/TTL/expiry rules, the SAME
// approve/reject/reverify API routes (unchanged -- they already dispatch
// generically on whatever resolveRemediationApproval()/resumeVerificationAction()
// return), the SAME GitHubRepositoryAdapter class (extended, not
// duplicated), the SAME live verifier (verifyRobotsTxtLive), the SAME
// bounded-retry/resumable-verification pattern and constants
// (VERIFICATION_RETRY_DELAY_MS), the SAME RemediationExecutionRecord audit
// trail, and the SAME workspace/connection isolation discipline every other
// function in this file already enforces.
// ============================================================

const ROBOTS_TXT_FINDING_PREFIX = "robots-txt-missing:";

/** Builds the real, structured task for a genuinely detected provisioning candidate -- never a placeholder; every field is either copied from the real, already-verified robots.txt candidate or derived from the real, live-checked plan. */
function buildRootSiteProvisioningTask(candidate: RemediationTaskView, plan: RootSiteProvisioningPlan): RemediationTaskView {
  return {
    taskId: randomUUID(),
    workspaceId: candidate.workspaceId,
    findingId: `root-site-provisioning-required:${plan.accountLogin}`,
    affectedResource: candidate.affectedResource,
    evidence: candidate.evidence,
    diagnosis: `${candidate.diagnosis} ${plan.reasonCurrentRepoCannotControl}`,
    requiredCapability: candidate.requiredCapability,
    requiredTool: candidate.requiredTool,
    proposedAction: plan.fileContent,
    approvalState: "pending",
    executionState: "not_started",
    verificationState: "not_started",
    finalStatus: "root_site_provisioning_required",
    failureReason: null,
    verificationEvidence: null,
    verificationResumeCount: 0,
    maxVerificationResumes: 2,
    rollbackData: null,
    rootSiteProvisioning: plan,
  };
}

/**
 * Section 1/8/13: real candidate detection + idempotent approval creation
 * for the root-site provisioning capability -- only ever called for a
 * robots.txt candidate (the one diagnosed real case this capability
 * addresses; see checkRootSiteProvisioningCandidate()'s own guard against
 * the canonical-link remediation type), and only when a connection exists
 * (provisioning is meaningless without a real, authenticated GitHub
 * identity to create the repository under). Returns `null` when this
 * candidate isn't a provisioning case at all (findingId prefix, or the
 * adapter's own real, live check finds nothing to provision) -- the caller
 * falls through to the existing, unchanged orchestrator path.
 */
async function attemptRootSiteProvisioningCandidate(workspaceId: string, connection: ConnectionRecord, candidate: RemediationTaskView): Promise<RemediationTaskView | null> {
  if (!connection || !candidate.findingId.startsWith(ROBOTS_TXT_FINDING_PREFIX)) {
    return null;
  }

  const provisioningFindingId = `root-site-provisioning-required:${connection.accountLogin}`;

  // Section 8/14: idempotent by construction, checked BEFORE any real
  // GitHub network call (same discipline attemptCandidate()'s own
  // existingPending/existingInFlight fast-paths already use for the
  // ordinary remediation path) -- an already-presented, still-valid
  // approval card for this SAME account's provisioning is returned as-is,
  // never re-created (no duplicate repo/approval).
  const existingAwaitingDecision = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: provisioningFindingId, status: "root_site_provisioning_required", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existingAwaitingDecision) {
    return JSON.parse(existingAwaitingDecision.taskJson) as RemediationTaskView;
  }

  // APPROVAL LIFECYCLE FIX (2026-08-16): a genuinely expired, never-decided
  // provisioning approval for this SAME account is resumed via the ONE
  // canonical refresh path -- never silently re-diagnosed as a brand new,
  // disconnected candidate (which would also mean a real, avoidable extra
  // live GitHub API call this refresh skips entirely). Matches status
  // "root_site_provisioning_required" (not yet acted on, simply past its
  // expiresAt) OR "expired" (a real Approve/Reject click already ran
  // against it and resolveRemediationApproval()'s own expiry check already
  // transitioned it -- see refreshExpiredApproval()'s own REFRESHABLE_STATUSES
  // doc comment for why "expired" must be included here too).
  const expiredAwaitingDecision = await db.remediationApproval.findFirst({
    where: {
      workspaceId,
      findingId: provisioningFindingId,
      OR: [
        { status: "root_site_provisioning_required", expiresAt: { lte: new Date() } },
        { status: "expired" },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (expiredAwaitingDecision) {
    const refreshed = await refreshExpiredApproval(workspaceId, expiredAwaitingDecision.id);
    if (refreshed.ok) {
      return refreshed.task;
    }
  }

  // Already approved and genuinely in flight (executing/deploying/awaiting
  // live confirmation) -- resultJson carries the latest real snapshot, same
  // convention as attemptCandidate()'s own existingInFlight lookup below.
  const existingInFlight = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: provisioningFindingId, status: "verification_pending" },
    orderBy: { createdAt: "desc" },
  });
  if (existingInFlight) {
    return JSON.parse(existingInFlight.resultJson ?? existingInFlight.taskJson) as RemediationTaskView;
  }

  // Already genuinely resolved for this account -- never re-provisioned.
  const existingResolved = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: provisioningFindingId, status: "resolved" },
    orderBy: { createdAt: "desc" },
  });
  if (existingResolved) {
    return JSON.parse(existingResolved.resultJson ?? existingResolved.taskJson) as RemediationTaskView;
  }

  // Only now -- no existing record covers this account -- make the real,
  // live GitHub check for whether provisioning genuinely applies.
  const adapter = new GitHubRepositoryAdapter();
  const plan = await adapter.checkRootSiteProvisioningCandidate({
    taskId: candidate.taskId,
    workspaceId,
    affectedResource: candidate.affectedResource,
    proposedAction: candidate.proposedAction,
  });
  if (!plan) {
    return null;
  }

  const task = buildRootSiteProvisioningTask(candidate, plan);
  await db.remediationApproval.create({
    data: {
      workspaceId,
      taskId: task.taskId,
      connectionId: connection.id,
      findingId: provisioningFindingId,
      affectedResource: task.affectedResource,
      repositoryFullName: plan.repositoryToCreate,
      proposedAction: task.proposedAction,
      taskJson: JSON.stringify(task),
      status: "root_site_provisioning_required",
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  return task;
}

/**
 * Sections 3-7: the real, multi-step provisioning execution + bounded live
 * verification -- reuses GitHubRepositoryAdapter.provisionRootSite()
 * (create -> configure Pages -> commit) for the execution half, and the
 * SAME bounded-retry, resumable-verification SHAPE the frozen
 * RemediationOrchestrator itself uses (mirrors runVerificationRound()'s own
 * real retry-then-pending-then-terminal logic; see that method's own
 * comment) for the verification half -- reusing verifyRobotsTxtLive (the
 * SAME live check that already backs every other robots.txt remediation's
 * RESOLVED determination in this system) rather than inventing a second
 * verification standard.
 */
async function executeRootSiteProvisioning(workspaceId: string, task: RemediationTaskView, verify: (url: string) => Promise<{ passed: boolean; evidence: string }>): Promise<RemediationTaskView> {
  const plan = task.rootSiteProvisioning;
  if (!plan) {
    return { ...task, executionState: "failed", finalStatus: "failed", failureReason: "Internal error: no provisioning plan was captured on this task." };
  }

  const adapter = new GitHubRepositoryAdapter();
  const outcome = await adapter.provisionRootSite(plan, workspaceId);
  if (!outcome.success) {
    return { ...task, executionState: "failed", finalStatus: "failed", failureReason: outcome.detail };
  }

  const executed: RemediationTaskView = { ...task, executionState: "completed", rollbackData: outcome.rollbackData ?? null };
  return runProvisioningVerificationRound(executed, verify);
}

const PROVISIONING_MAX_RETRIES_PER_ROUND = 2;
const PROVISIONING_DEFAULT_MAX_RESUMES = 2;

/** ONE bounded verification round -- real retry with the SAME real deploy-propagation delay (VERIFICATION_RETRY_DELAY_MS) every other remediation type already uses, then either RESOLVED, a genuinely resumable "verification_pending", or (once the resume budget is exhausted) a terminal "failed". Never rolls back the newly created repository/Pages config (Section 9: "NEVER delete a pre-existing repository... any destructive rollback requires explicit approval/security policy" -- nothing here is pre-existing, and no such separate approval exists, so the honest, safe behavior is to leave the real, created infrastructure in place and record the failure for manual review). */
async function runProvisioningVerificationRound(task: RemediationTaskView, verify: (url: string) => Promise<{ passed: boolean; evidence: string }>): Promise<RemediationTaskView> {
  const plan = task.rootSiteProvisioning;
  if (!plan) {
    return { ...task, verificationState: "failed", finalStatus: "failed", failureReason: "Internal error: no provisioning plan was captured on this task." };
  }

  let current: RemediationTaskView = { ...task, verificationState: "in_progress", finalStatus: "verifying" };
  for (let attempt = 0; attempt <= PROVISIONING_MAX_RETRIES_PER_ROUND; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, VERIFICATION_RETRY_DELAY_MS));
    }
    const result = await verify(plan.verificationUrl);
    if (result.passed) {
      return { ...current, verificationState: "passed", finalStatus: "resolved", verificationEvidence: result.evidence };
    }
    current = { ...current, verificationEvidence: result.evidence };
  }

  const resumeCount = current.verificationResumeCount ?? 0;
  const maxResumes = current.maxVerificationResumes ?? PROVISIONING_DEFAULT_MAX_RESUMES;
  if (resumeCount >= maxResumes) {
    return {
      ...current,
      verificationState: "failed",
      finalStatus: "failed",
      failureReason: `Live verification of "${plan.verificationUrl}" did not pass after ${PROVISIONING_MAX_RETRIES_PER_ROUND + 1} attempt(s) per round, across ${resumeCount + 1} total round(s) (1 initial + ${resumeCount} resume(s)). The newly created repository ("${plan.repositoryToCreate}") and its GitHub Pages configuration were left in place -- never automatically deleted -- for manual review.`,
    };
  }
  return { ...current, verificationState: "pending", finalStatus: "verification_pending" };
}

/**
 * THE shared per-candidate attempt used by every remediation entry point
 * (runRobotsTxtRemediation() and runTechnicalSeoRemediation()) -- one real
 * candidate in, one real, final-for-now task out. No-loop protection
 * (reuse an existing pending/not_remediable record instead of re-asking)
 * runs BEFORE ever touching the real orchestrator/adapter; a genuinely new
 * eligibility result is persisted according to what it actually was
 * (pending -> "pending", NOT_REMEDIABLE -> "not_remediable", anything else
 * left exactly as the orchestrator produced it). This is the ONE place
 * that decides "does this specific finding become a real approval card, or
 * not" -- shared so both entry points enforce the exact same rules.
 */
async function attemptCandidate(workspaceId: string, orchestrator: Orchestrator, connection: ConnectionRecord, candidate: RemediationTaskView): Promise<RemediationTaskView> {
  const existingPending = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: candidate.findingId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existingPending) {
    return JSON.parse(existingPending.taskJson) as RemediationTaskView;
  }

  // APPROVAL LIFECYCLE FIX (2026-08-16): a genuinely expired, never-decided
  // "pending" row for this SAME finding is resumed via the ONE canonical
  // refresh path (refreshExpiredApproval()) rather than silently left
  // dangling while a disconnected new candidate is planned from scratch --
  // this is what makes "the existing Doctor case is resumable without
  // starting a new case" true for a normal follow-up chat message, not
  // just for an explicit Approve-click recovery (see
  // RemediationApprovalCard's own decide() for the other real trigger).
  // Matches status "pending" (not yet acted on, simply past its expiresAt)
  // OR "expired" (a real Approve/Reject click already ran against it and
  // resolveRemediationApproval()'s own expiry check already transitioned
  // it -- see refreshExpiredApproval()'s own REFRESHABLE_STATUSES doc
  // comment for why "expired" must be included here too).
  const expiredPending = await db.remediationApproval.findFirst({
    where: {
      workspaceId,
      findingId: candidate.findingId,
      OR: [
        { status: "pending", expiresAt: { lte: new Date() } },
        { status: "expired" },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (expiredPending) {
    const refreshed = await refreshExpiredApproval(workspaceId, expiredPending.id);
    if (refreshed.ok) {
      return refreshed.task;
    }
  }

  // PRODUCTION HARDENING (2026-08-15, system-consistency pass): a real,
  // confirmed defect -- an approval genuinely IN FLIGHT (already approved
  // and executed, now waiting on live deployment propagation to confirm)
  // was never recognized by this fast-path, since only "pending" was
  // checked here. A follow-up chat message ("check again", or simply the
  // orchestrated case resuming on its own) that re-invokes
  // runTechnicalSeoRemediation() for the SAME finding while it is still
  // "verification_pending" would fall through to planAndRequestApproval()
  // below and create a genuinely DUPLICATE second approval/execution for
  // the identical finding -- a real double-execution risk this task's own
  // "no duplicate remediation" and "verification pending/resume" handoff
  // requirements exist to prevent. resultJson (not taskJson) carries the
  // LATEST real snapshot -- the same field resumeVerificationAction() its
  // own self reads from (see this file's own comment on that function) --
  // so this returns the current, real, up-to-date state (including
  // verificationResumeCount/rollbackData so far), never the stale
  // pre-execution snapshot.
  const existingInFlight = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: candidate.findingId, status: "verification_pending" },
    orderBy: { createdAt: "desc" },
  });
  if (existingInFlight) {
    return JSON.parse(existingInFlight.resultJson ?? existingInFlight.taskJson) as RemediationTaskView;
  }

  if (connection) {
    // STALE NOT_REMEDIABLE CACHE FIX (2026-08-22): a real, live-reproduced
    // defect -- this cache used to match on findingId + connectionId alone,
    // so a genuine code fix to a planner's OWN affectedResource construction
    // (e.g. sitemap-remediation-planner.ts's project-site targeting fix)
    // was permanently masked by a row persisted under the SAME findingId
    // before the fix existed (findingId is derived from siteUrl, never from
    // affectedResource -- see each planner's own findingId construction) --
    // confirmed live: a "not_remediable" row cached the OLD, pre-fix
    // origin-root affectedResource with a 100-year expiresAt, so every
    // subsequent request kept returning that stale verdict verbatim,
    // never re-running the real eligibility check against the NOW-correct
    // candidate. Requiring affectedResource to ALSO match is strictly safer,
    // never weaker: it only makes this cache MORE precise about what it was
    // actually judged against -- the moment a planner legitimately changes
    // what it targets, the stale judgment no longer applies and a real,
    // live eligibility check runs again, exactly as it would for a
    // genuinely new finding.
    const knownNotRemediable = await db.remediationApproval.findFirst({
      where: { workspaceId, findingId: candidate.findingId, affectedResource: candidate.affectedResource, connectionId: connection.id, status: "not_remediable" },
      orderBy: { createdAt: "desc" },
    });
    if (knownNotRemediable) {
      return JSON.parse(knownNotRemediable.taskJson) as RemediationTaskView;
    }

    // ROOT-SITE PROVISIONING CAPABILITY (2026-08-16): checked BEFORE the
    // real orchestrator/adapter's ordinary eligibility path -- a real,
    // live-checked provisioning candidate takes over the SAME candidate,
    // never falling through to the ordinary NOT_REMEDIABLE outcome the
    // orchestrator would otherwise produce for it (see
    // GitHubRepositoryAdapter.isEligibleForTask()'s own, UNCHANGED
    // describeOriginRootAlternative() addendum -- that remains the correct,
    // real outcome for every OTHER origin-root case: root repo exists
    // without push access, or exists and is switchable).
    const provisioning = await attemptRootSiteProvisioningCandidate(workspaceId, connection, candidate);
    if (provisioning) {
      return provisioning;
    }
  }

  const { task, approvalRequest } = await orchestrator.planAndRequestApproval(candidate);

  if (task.finalStatus === "pending_approval" && approvalRequest && connection) {
    await db.remediationApproval.create({
      data: {
        workspaceId,
        taskId: task.taskId,
        connectionId: connection.id,
        findingId: task.findingId,
        affectedResource: task.affectedResource,
        repositoryFullName: connection.repositoryFullName,
        proposedAction: task.proposedAction,
        taskJson: JSON.stringify(task),
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });
    return task;
  }

  if (task.finalStatus === "blocked" && task.failureReason?.startsWith(NOT_REMEDIABLE_PREFIX) && connection) {
    const reworded = toNoEligibleFindingTask(task);
    await db.remediationApproval.create({
      data: {
        workspaceId,
        taskId: task.taskId,
        connectionId: connection.id,
        findingId: task.findingId,
        affectedResource: task.affectedResource,
        repositoryFullName: connection.repositoryFullName,
        proposedAction: task.proposedAction,
        taskJson: JSON.stringify(reworded),
        status: "not_remediable",
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
      },
    });
    return reworded;
  }

  // Connection-missing / auth-level BLOCKED, or any other non-pending
  // outcome -- returned exactly as the orchestrator produced it, never
  // reworded or persisted as a structural "not remediable" fact (a
  // missing/invalid connection is fixable by reconnecting, not a
  // permanent property of this finding).
  return task;
}

/**
 * Runs the real robots.txt remediation lifecycle up to (and no further than)
 * a genuine approval gate, scoped to `workspaceId` (client isolation): a
 * real live check of `{siteUrl}/robots.txt`; if it's genuinely missing, a
 * real planned task run through planAndRequestApproval() -- eligibility
 * (does a real, active connection exist for this workspace, AND can it
 * actually control/deploy/verify THIS specific affected resource? -- see
 * GitHubRepositoryAdapter.isEligibleForTask()) checked first. Returns `null`
 * when robots.txt is already present -- nothing to remediate, never
 * fabricated.
 *
 * ISSUE-SELECTION FIX (2026-08-14): a candidate whose eligibility check
 * comes back NOT_REMEDIABLE (a structural fact about the resource/
 * connection pair -- e.g. this repository's real Pages deployment doesn't
 * serve the affected resource at all) is never turned into an approval
 * request (selectRemediableCandidate() stops the loop and the caller below
 * never persists a "pending" row for it), and is persisted as
 * "not_remediable" so it is never re-offered as a candidate again for the
 * SAME connection -- see the fast-path lookup below, which avoids even
 * re-running the real eligibility check (and its real GitHub API calls) on
 * every repeated request.
 *
 * DELIBERATELY STOPS AT pending_approval for a genuinely eligible candidate
 * (2026-08-14 interactive-approval pass): this used to call
 * orchestrator.run(), which synchronously drove the task through approval
 * -> execute -> verify inside one stateless HTTP request -- and since
 * createWebApprovalChannel() can never supply genuine human authorization
 * for `deploy_production_change` (see approval.ts's own header), every
 * real, eligible remediation immediately reached REJECTED with no way for
 * an actual human to approve it. When eligible, this now persists a real
 * RemediationApproval row (bound to workspace/task/connection/exact
 * proposed change, with an expiry) and returns the task at
 * pending_approval -- the client-visible approval action is
 * resolveRemediationApproval(), invoked only by a real Approve/Reject
 * click.
 */
export async function runRobotsTxtRemediation(workspaceId: string, siteUrl: string): Promise<RemediationTaskView | null> {
  const modules = await getModules();
  const { verifyRobotsTxtLive, planRobotsTxtRemediation } = modules;

  const robotsUrl = new URL("/robots.txt", siteUrl).toString();
  const currentState = await verifyRobotsTxtLive(robotsUrl);
  if (currentState.passed) {
    return null;
  }

  const planned = planRobotsTxtRemediation({ workspaceId, siteUrl, robotsTxtFound: false, sitemapUrlsFound: 0 });
  if (!planned) {
    return null;
  }

  const connection = toUsableConnectionRecord(await db.gitHubConnection.findUnique({ where: { userId: workspaceId } }));
  const orchestrator = buildOrchestrator(modules);
  const selection = await selectRemediableCandidate([planned], (candidate) => attemptCandidate(workspaceId, orchestrator, connection, candidate));

  if (selection.outcome === "selected") {
    return selection.task;
  }
  return selection.attempted[selection.attempted.length - 1] ?? null;
}

/**
 * THE general, multi-candidate entry point (2026-08-14 "at least one real
 * end-to-end controllable remediation" requirement): runs REAL, independent
 * live checks for every remediation type this system currently ships with
 * (robots.txt, plus the homepage's canonical <link> tag), plans a real
 * candidate for each one that's genuinely broken, and uses
 * selectRemediableCandidate() to pick the first one that's genuinely
 * eligible for this workspace's real connection -- proving the generic
 * selection mechanism (built for the issue-selection fix) for real, with a
 * genuine second candidate type, not just synthetic tests. Returns `null`
 * only when EVERY real check genuinely passed already -- nothing to
 * remediate at all, never fabricated.
 */
export async function runTechnicalSeoRemediation(workspaceId: string, siteUrl: string): Promise<RemediationTaskView | null> {
  const modules = await getModules();
  const { verifyRobotsTxtLive, planRobotsTxtRemediation, verifyCanonicalUrlLive, planCanonicalUrlRemediation } = modules;

  const candidates: RemediationTaskView[] = [];

  const robotsUrl = new URL("/robots.txt", siteUrl).toString();
  const robotsState = await verifyRobotsTxtLive(robotsUrl);
  if (!robotsState.passed) {
    const robotsCandidate = planRobotsTxtRemediation({ workspaceId, siteUrl, robotsTxtFound: false, sitemapUrlsFound: 0 });
    if (robotsCandidate) candidates.push(robotsCandidate);
  }

  const canonicalState = await verifyCanonicalUrlLive(siteUrl);
  if (!canonicalState.passed) {
    const canonicalCandidate = planCanonicalUrlRemediation({
      workspaceId,
      pageUrl: siteUrl,
      canonicalMatchesPageUrl: false,
      currentCanonical: canonicalState.currentCanonical,
    });
    if (canonicalCandidate) candidates.push(canonicalCandidate);
  }

  if (candidates.length === 0) {
    return null;
  }

  const connection = toUsableConnectionRecord(await db.gitHubConnection.findUnique({ where: { userId: workspaceId } }));
  const orchestrator = buildOrchestrator(modules);
  const selection = await selectRemediableCandidate(candidates, (candidate) => attemptCandidate(workspaceId, orchestrator, connection, candidate));

  if (selection.outcome === "selected") {
    return selection.task;
  }
  return selection.attempted[selection.attempted.length - 1] ?? null;
}

// ============================================================
// DOCTOR FLOW COMPLETION (2026-08-21): AUDIT -> REMEDIATION using the real
// audit's own findings as the single source of truth, replacing the
// previous independent live re-check with the SAME real evidence the audit
// already computed -- see this task's own Rule 1 ("do not discard audit
// findings and do not replace them with hard-coded checks"). Deliberately
// reuses every existing, already-tested piece unchanged: the same
// planRobotsTxtRemediation()/planCanonicalUrlRemediation() planners, the
// same selectRemediableCandidate()/attemptCandidate() approval-gated
// execution path, the same RemediationApproval table and Human Approval
// Gate. Only the SOURCE of "what needs remediation" changed -- from an
// independent live re-check to the audit's own real findings.
//
// PRIORITIZATION (Rule 2): findings are sorted deterministically by
// severity (critical > warning > info), then category, then original
// order -- never a "first match in source-code order" bias. The
// PRIORITY-ORDERED candidate list is what selectRemediableCandidate()
// receives, so the highest-priority genuinely actionable finding is always
// the one that reaches a human decision first.
//
// UNSUPPORTED FINDINGS (Rule 3): only "crawlability" (robots.txt) and
// "canonical" findings have a real, tested, safe remediation implementation
// in this system today. Every OTHER finding category is honestly reported
// as unsupported -- this system never pretends to fix something it has no
// real, safe, tested capability for. Extending real remediation coverage to
// additional finding categories (meta description, Open Graph, internal
// links, security headers, etc.) is real, separate, future work -- each one
// needs its own careful, tested, live-verified planner/executor exactly
// like these two, and is deliberately out of scope for "connect the
// existing pieces correctly" (this task's own boundary).
// ============================================================

/** One real audit finding, ranked by deterministic priority -- never a fabricated score. */
export interface PrioritizedFinding {
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
  readonly recommendation: string;
  readonly priorityRank: number;
}

/** A real finding this system genuinely has no automated remediation for -- reported honestly, never silently dropped or fabricated as "fixed". */
export interface UnsupportedFinding {
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
  readonly reason: string;
}

const SEVERITY_PRIORITY_WEIGHT: Record<"critical" | "warning" | "info", number> = { critical: 0, warning: 1, info: 2 };

/** Deterministic: severity first (critical > warning > info), then category name, then original position -- never randomized, never "whichever check runs first in source code". */
export function prioritizeFindings(findings: readonly { readonly category: string; readonly severity: "info" | "warning" | "critical"; readonly message: string; readonly recommendation: string }[]): readonly PrioritizedFinding[] {
  return findings
    .map((finding, originalIndex) => ({ finding, originalIndex }))
    .sort((a, b) => {
      const severityDelta = SEVERITY_PRIORITY_WEIGHT[a.finding.severity] - SEVERITY_PRIORITY_WEIGHT[b.finding.severity];
      if (severityDelta !== 0) return severityDelta;
      const categoryDelta = a.finding.category.localeCompare(b.finding.category);
      if (categoryDelta !== 0) return categoryDelta;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ finding }, priorityIndex) => ({ ...finding, priorityRank: priorityIndex + 1 }));
}

// SITEMAP REMEDIATION CAPABILITY (2026-08-22): "sitemap" (SitemapChecker's
// own real category -- src/agents/website-audit-agent/checks/sitemap-checker.ts)
// now has a real, tested automated remediation (planSitemapRemediation +
// GitHubRepositoryAdapter's sitemap.xml scope), joining robots.txt/canonical
// as the third real remediation type this system ships with.
const SUPPORTED_REMEDIATION_CATEGORIES = new Set(["crawlability", "canonical", "sitemap"]);

export interface AuditDrivenRemediationResult {
  readonly prioritizedFindings: readonly PrioritizedFinding[];
  readonly task: RemediationTaskView | null;
  readonly unsupportedFindings: readonly UnsupportedFinding[];
}

/**
 * THE audit-driven remediation entry point: builds a real, priority-ordered
 * remediation strategy directly from a real, already-computed
 * FullAuditResult's own findings (never re-checks live, never discards
 * findings, never invents a hard-coded check) and attempts it through the
 * exact same real, already-tested approval-gated execution path every other
 * remediation entry point in this file uses. Returns the full prioritized
 * finding list (for reporting), the one task that reached a real decision
 * point this turn (or null if nothing supported needed fixing), and the
 * honest list of findings this system has no automated remediation for.
 */
export async function runRemediationFromAuditFindings(
  workspaceId: string,
  siteUrl: string,
  auditFindings: readonly { readonly category: string; readonly severity: "info" | "warning" | "critical"; readonly message: string; readonly recommendation: string }[],
  crawlEvidence: { readonly robotsTxtFound: boolean; readonly sitemapUrlsFound: number; readonly crawledUrls?: readonly string[] },
): Promise<AuditDrivenRemediationResult> {
  const prioritizedFindings = prioritizeFindings(auditFindings);
  const modules = await getModules();
  const { planRobotsTxtRemediation, planCanonicalUrlRemediation, planSitemapRemediation } = modules;

  const candidates: RemediationTaskView[] = [];
  const unsupportedFindings: UnsupportedFinding[] = [];
  let robotsTxtCandidatePlanned = false;
  let canonicalCandidatePlanned = false;
  let sitemapCandidatePlanned = false;

  for (const finding of prioritizedFindings) {
    // CATEGORY-MATCH FIX (2026-08-22): a real, confirmed bug -- the real
    // checker that inspects robots.txt content (RobotsTxtChecker, in
    // src/agents/website-audit-agent/checks/robots-txt-checker.ts) tags its
    // findings with category "robots-txt", never "crawlability" (that name
    // belongs to a DIFFERENT checker -- CrawlabilityChecker -- which only
    // checks a page's <meta name="robots"> tag, an unrelated signal). Before
    // this fix, a genuine robots.txt finding (e.g. "No Sitemap: reference
    // was found in the supplied robots.txt content.") never matched either
    // branch below and was silently misfiled into unsupportedFindings,
    // even though planRobotsTxtRemediation() already exists specifically to
    // evaluate it. Additive only -- "crawlability" is still accepted
    // unchanged for whatever it already matched.
    if (finding.category === "crawlability" || finding.category === "robots-txt") {
      if (robotsTxtCandidatePlanned) continue;
      robotsTxtCandidatePlanned = true;
      const candidate = planRobotsTxtRemediation({ workspaceId, siteUrl, robotsTxtFound: crawlEvidence.robotsTxtFound, sitemapUrlsFound: crawlEvidence.sitemapUrlsFound });
      if (candidate) candidates.push(candidate);
    } else if (finding.category === "canonical") {
      if (canonicalCandidatePlanned) continue;
      canonicalCandidatePlanned = true;
      // The real audit finding itself is the evidence a canonical tag is
      // missing/mismatched on this page -- honest about not having the raw
      // current-canonical value the audit's own finding text doesn't
      // structurally capture (null), never a guessed/fabricated value.
      const candidate = planCanonicalUrlRemediation({ workspaceId, pageUrl: siteUrl, canonicalMatchesPageUrl: false, currentCanonical: null });
      if (candidate) candidates.push(candidate);
    } else if (finding.category === "sitemap") {
      // SITEMAP REMEDIATION CAPABILITY (2026-08-22): drawn EXCLUSIVELY from
      // crawlEvidence.crawledUrls -- the real, already-crawled,
      // successfully-fetched URLs from THIS SAME audit (see
      // website-audit.ts's CrawlSummary.crawledUrls and
      // sitemap-remediation-planner.ts's own header). Never invents a URL;
      // when no real crawled URLs are available (older/persisted audits that
      // predate this field), planSitemapRemediation() itself honestly
      // returns null rather than proposing an empty sitemap.
      if (sitemapCandidatePlanned) continue;
      sitemapCandidatePlanned = true;
      const candidate = planSitemapRemediation({ workspaceId, siteUrl, sitemapUrlsFound: crawlEvidence.sitemapUrlsFound, crawledUrls: crawlEvidence.crawledUrls ?? [] });
      if (candidate) candidates.push(candidate);
    } else if (!SUPPORTED_REMEDIATION_CATEGORIES.has(finding.category)) {
      unsupportedFindings.push({
        category: finding.category,
        severity: finding.severity,
        message: finding.message,
        reason: `No automated remediation exists for category "${finding.category}" in this system yet -- this finding requires manual review.`,
      });
    }
  }

  if (candidates.length === 0) {
    return { prioritizedFindings, task: null, unsupportedFindings };
  }

  const connection = toUsableConnectionRecord(await db.gitHubConnection.findUnique({ where: { userId: workspaceId } }));
  const orchestrator = buildOrchestrator(modules);
  const selection = await selectRemediableCandidate(candidates, (candidate) => attemptCandidate(workspaceId, orchestrator, connection, candidate));
  const task = selection.outcome === "selected" ? selection.task : (selection.attempted[selection.attempted.length - 1] ?? null);

  return { prioritizedFindings, task, unsupportedFindings };
}

export interface RemediationApprovalView {
  readonly id: string;
  readonly taskId: string;
  readonly findingId: string;
  readonly affectedResource: string;
  readonly repositoryFullName: string;
  readonly proposedAction: string;
  readonly status: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

function toApprovalView(row: { id: string; taskId: string; findingId: string; affectedResource: string; repositoryFullName: string; proposedAction: string; status: string; createdAt: Date; expiresAt: Date }): RemediationApprovalView {
  return {
    id: row.id,
    taskId: row.taskId,
    findingId: row.findingId,
    affectedResource: row.affectedResource,
    repositoryFullName: row.repositoryFullName,
    proposedAction: row.proposedAction,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Real, non-secret lookup for the approval card UI -- workspace-scoped, so one client can never read another's pending approval. */
export async function getRemediationApproval(workspaceId: string, approvalId: string): Promise<RemediationApprovalView | null> {
  const row = await db.remediationApproval.findFirst({ where: { id: approvalId, workspaceId } });
  return row ? toApprovalView(row) : null;
}

// REMEDIATION EXECUTION RECORD RETRIEVAL FIX: closes the one confirmed gap
// from the read-only observability investigation -- RemediationExecutionRecord
// (schema.prisma's own "structured, auditable record of one real (or
// attempted) production modification") was created via recordExecution()
// (below) but never read back by any route or UI. This is the smallest
// retrieval path: reuses the EXISTING stable identifier every execution
// record already carries -- remediationTaskId, the same RemediationTask.taskId
// RemediationApproval.taskId already stores -- rather than inventing a new
// one. No new model, no change to recordExecution() or any write path.

export interface RemediationExecutionRecordView {
  readonly id: string;
  readonly remediationTaskId: string;
  /** The real acting integration for this execution (e.g. "github") -- this system's own "agent/tool" for a production write. */
  readonly provider: string;
  /** The real affected resource/URL this execution targeted. */
  readonly target: string;
  readonly proposedAction: string;
  readonly result: string;
  readonly finalStatus: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly changedFiles: readonly string[] | null;
  readonly commitReference: string | null;
  readonly deploymentReference: string | null;
  readonly verificationReference: string | null;
  readonly rollbackReference: string | null;
  readonly error: string | null;
}

function toExecutionRecordView(row: {
  id: string;
  remediationTaskId: string;
  provider: string;
  target: string;
  intendedChangesJson: string;
  result: string;
  finalStatus: string;
  startedAt: Date;
  completedAt: Date | null;
  changedFilesJson: string | null;
  commitReference: string | null;
  deploymentReference: string | null;
  verificationReference: string | null;
  rollbackReference: string | null;
  error: string | null;
}): RemediationExecutionRecordView {
  let changedFiles: readonly string[] | null = null;
  if (row.changedFilesJson) {
    try {
      const parsed = JSON.parse(row.changedFilesJson);
      if (Array.isArray(parsed)) changedFiles = parsed;
    } catch {
      changedFiles = null;
    }
  }
  return {
    id: row.id,
    remediationTaskId: row.remediationTaskId,
    provider: row.provider,
    target: row.target,
    proposedAction: row.intendedChangesJson,
    result: row.result,
    finalStatus: row.finalStatus,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    changedFiles,
    commitReference: row.commitReference,
    deploymentReference: row.deploymentReference,
    verificationReference: row.verificationReference,
    rollbackReference: row.rollbackReference,
    error: row.error,
  };
}

export type ExecutionRecordsForApprovalResult =
  | { readonly found: true; readonly records: readonly RemediationExecutionRecordView[] }
  | { readonly found: false };

/**
 * Real, workspace-scoped retrieval of every RemediationExecutionRecord for
 * one approval's own real remediation task -- reuses the SAME tenant-scoped
 * lookup pattern getRemediationApproval() already uses (findFirst({ id,
 * workspaceId })), so an approval id belonging to a different workspace is
 * indistinguishable from "does not exist" (never a cross-tenant hint).
 * `found: false` means the approval itself doesn't exist for this workspace
 * -- the caller (the API route) turns this into a 404. `found: true` with an
 * empty `records` array is the honest, real answer for an approval that
 * exists but was never executed (still pending, or rejected/expired before
 * execution) -- never a fabricated record. Ordered oldest-first
 * (chronological, matching startedAt) -- a real execution's own retry
 * attempts (if any) read in the order they actually happened.
 */
export async function listRemediationExecutionsForApproval(workspaceId: string, approvalId: string): Promise<ExecutionRecordsForApprovalResult> {
  const approval = await db.remediationApproval.findFirst({ where: { id: approvalId, workspaceId }, select: { taskId: true } });
  if (!approval) {
    return { found: false };
  }
  const rows = await db.remediationExecutionRecord.findMany({
    where: { userId: workspaceId, remediationTaskId: approval.taskId },
    orderBy: { startedAt: "asc" },
  });
  return { found: true, records: rows.map(toExecutionRecordView) };
}

export interface RemediationApprovalCardMeta {
  readonly id: string;
  readonly repositoryFullName: string;
  readonly affectedResource: string;
  readonly proposedAction: string;
  readonly expiresAt: string;
  readonly status: string;
  readonly provisioningPlan?: RootSiteProvisioningPlan | null;
}

/** Every finalStatus that has a real, human-decidable or resumable approval row worth rendering an interactive card for -- deliberately excludes terminal statuses (resolved/rejected/failed/failed_with_rollback/rollback_failed/not_remediable/blocked), which summarizeRemediationForChat()'s own text already covers in full; never a card with no Approve/Reject or Check-again action to offer. */
const APPROVAL_CARD_STATUSES = new Set(["pending_approval", "verification_pending", "root_site_provisioning_required"]);

/**
 * HUMAN APPROVAL GATE ROUTING FIX (2026-08-19): a real, workspace-scoped
 * read of every currently awaiting-decision approval -- reuses the exact
 * same APPROVAL_CARD_STATUSES allowlist buildRemediationApprovalCardMeta()
 * uses for "is this worth surfacing", so the chat-level Human Approval Gate
 * status check and the inline per-task approval card can never disagree
 * about what counts as pending. This is what makes the gate's real state
 * reachable directly (via task-router.ts's new "human_approval_gate"
 * status) without requiring a fresh audit/remediation run first -- pure
 * read, never mutates, never approves/rejects anything.
 *
 * LIVE STALE-APPROVAL FIX (2026-08-19, follow-up): a real, live-confirmed
 * bug -- this function returned every row matching the status allowlist
 * regardless of whether it had since EXPIRED, or belonged to a repository
 * the workspace is no longer connected to. Two real production rows
 * (root_site_provisioning_required, expiresAt in the past) kept being
 * reported as actionable even after the connection had switched to a
 * completely different repository. Two independent, deliberately DIFFERENT
 * fixes, both required:
 *
 *  1. expiresAt: { gt: new Date() } -- an expired row is never actionable
 *     regardless of its stored status column, mirroring attemptCandidate()'s
 *     own existingPending/existingAwaitingDecision convention elsewhere in
 *     this file.
 *  2. Repository scoping, type-aware -- NOT a blanket repositoryFullName
 *     equality check applied to every row. An ordinary approval
 *     (pending_approval/verification_pending) legitimately belongs to
 *     whichever repository was connected when it was created, and is only
 *     still current if that repository is STILL the one connected. A
 *     root_site_provisioning_required row is structurally different: its
 *     own repositoryFullName names the account's ORIGIN-ROOT repository
 *     ADASOS would create/use -- deliberately independent of whichever
 *     PROJECT repository happens to be connected (provisioning exists
 *     precisely because the connected project repo cannot control the
 *     origin root). Applying the same equality check to it would hide a
 *     genuinely still-valid provisioning approval the moment a different
 *     project repository gets connected -- a real regression this fix must
 *     not introduce.
 */
export async function listPendingApprovals(workspaceId: string): Promise<RemediationApprovalView[]> {
  const connection = await db.gitHubConnection.findUnique({ where: { userId: workspaceId } });
  if (!connection || connection.status !== "active" || !connection.repositoryFullName) {
    return [];
  }
  const rows = await db.remediationApproval.findMany({
    where: { workspaceId, status: { in: Array.from(APPROVAL_CARD_STATUSES) }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const scoped = rows.filter((row) => row.status === "root_site_provisioning_required" || row.repositoryFullName === connection.repositoryFullName);
  return scoped.map(toApprovalView);
}

/**
 * ROOT-SITE PROVISIONING CAPABILITY UI-SURFACING FIX (2026-08-16): the
 * single, shared decision of "does this real, already-produced
 * RemediationTaskView warrant an interactive approval card in chat, and
 * what does its metadata look like" -- extracted out of
 * api/workspace/messages/route.ts's own applyRemediationResult() (which
 * had this exact logic inlined, private, and therefore never directly
 * testable) so every chat entry point uses the SAME real, workspace-scoped
 * DB lookup and the SAME status allowlist, and so a regression here (a
 * finalStatus quietly falling outside the "show a card" set, or the DB
 * lookup silently returning nothing for a real row) has a real, permanent
 * test guarding it instead of only being caught by a live user report.
 * Pure read -- never mutates the approval row, never approves/rejects
 * anything, safe to call repeatedly (e.g. once per turn a task is
 * returned) with no side effects.
 */
export async function buildRemediationApprovalCardMeta(task: RemediationTaskView): Promise<RemediationApprovalCardMeta | null> {
  if (!APPROVAL_CARD_STATUSES.has(task.finalStatus)) {
    return null;
  }
  const approvalRow = await db.remediationApproval.findUnique({ where: { taskId: task.taskId } });
  if (!approvalRow) {
    return null;
  }
  return {
    id: approvalRow.id,
    repositoryFullName: approvalRow.repositoryFullName,
    affectedResource: approvalRow.affectedResource,
    proposedAction: approvalRow.proposedAction,
    expiresAt: approvalRow.expiresAt.toISOString(),
    status: approvalRow.status,
    provisioningPlan: task.rootSiteProvisioning ?? undefined,
  };
}

export type RemediationApprovalRefreshResult =
  | { readonly ok: true; readonly refreshed: boolean; readonly task: RemediationTaskView }
  | { readonly ok: false; readonly error: string };

/**
 * Statuses refreshExpiredApproval() will act on. "pending"/
 * "root_site_provisioning_required" are the two real awaiting-decision
 * statuses (mirrors APPROVAL_CARD_STATUSES minus "verification_pending" --
 * an ALREADY-approved, already-executed change with its own, separate
 * resumable-verification lifecycle; refreshing makes no sense for
 * something already committed and deployed). "expired" is ALSO real and
 * refreshable here, not a dead end: resolveRemediationApproval()'s own
 * (UNCHANGED) expiry check already transitions a row straight from
 * "pending"/"root_site_provisioning_required" to "expired" the FIRST time
 * anyone attempts a real decision against it -- which is exactly what a
 * user's own Approve/Reject click on a stale card does, immediately before
 * the card's own automatic refresh call runs (see workspace-shell.tsx's
 * own decide()). Excluding "expired" here would make that automatic
 * recovery permanently unreachable in the one situation it exists for.
 */
const REFRESHABLE_STATUSES = new Set(["pending", "root_site_provisioning_required", "expired"]);

/** The row `status` a fresh replacement is issued at, derived from the ORIGINAL task's own finalStatus (captured in taskJson before any expiry transition) -- never from the retiring row's own (possibly already "expired") status column. */
function awaitingDecisionRowStatusFor(task: RemediationTaskView): string {
  return task.finalStatus === "root_site_provisioning_required" ? "root_site_provisioning_required" : "pending";
}

/**
 * APPROVAL LIFECYCLE FIX (2026-08-16) -- THE single, canonical "refresh/
 * reissue a pending approval for its existing case" path (Section 4's own
 * requirement: "provide ONE canonical... path"). Reused by both real
 * triggers this system has: (1) attemptCandidate()/
 * attemptRootSiteProvisioningCandidate() finding a genuinely expired,
 * never-decided approval while re-diagnosing the SAME finding (the normal
 * "send another chat message" resumption path), and (2) a real, explicit
 * Approve/Reject click against an approval that has since expired (the
 * approval-card's own automatic "your click failed because this expired --
 * here's a fresh one" recovery -- see workspace-shell.tsx's own decide()).
 *
 * Never approves or rejects anything -- this ONLY ever produces a fresh,
 * still-undecided approval (or returns the current one unchanged if it's
 * still genuinely valid); a real human must still explicitly decide the
 * result. Idempotent: if a fresh, unexpired replacement for this SAME
 * finding already exists (a concurrent refresh, or the natural
 * re-diagnosis path already created one), reuses THAT instead of ever
 * creating a second one (Section 4's "at most one new pending approval").
 * The retired row is marked "superseded" (never deleted) -- distinct from
 * the "expired" status a lazy, direct decide() attempt against a dead row
 * still produces (see resolveRemediationApproval()'s own expiry checks,
 * UNCHANGED by this fix) -- both are real, permanent, auditable facts
 * about why a given row can never be decided, and both are refused
 * identically by every existing validation path (neither is a status
 * AWAITING_DECISION_STATUSES/APPROVAL_CARD_STATUSES recognizes).
 */
export async function refreshExpiredApproval(workspaceId: string, approvalId: string): Promise<RemediationApprovalRefreshResult> {
  const row = await db.remediationApproval.findFirst({ where: { id: approvalId, workspaceId } });
  if (!row) {
    return { ok: false, error: "This approval was not found for your workspace." };
  }

  // REAL BUG FOUND DURING LIVE PRODUCTION VERIFICATION (2026-08-16): a
  // persisted chat message can keep referencing an approval id that has
  // SINCE been superseded (e.g. an earlier refresh that only ever updated
  // a browser tab's in-memory state, never a new persisted message -- or
  // simply a second, older tab/device still showing a stale card). A
  // decide() attempt against that id fails with "already been decided
  // (status: superseded)" -- a DIFFERENT error shape than "expired", which
  // the caller's own error-matching used to require, permanently stranding
  // the user on a dead card with no path forward. The real fix: for a
  // superseded row specifically, don't try to refresh IT (there is nothing
  // to refresh -- its replacement already exists) -- look up and surface
  // the CURRENT, real, most-recent approval for the SAME finding instead,
  // whatever its live status now is. Never creates a duplicate; only ever
  // reads.
  if (row.status === "superseded") {
    const latestForCase = await db.remediationApproval.findFirst({
      where: { workspaceId, findingId: row.findingId },
      orderBy: { createdAt: "desc" },
    });
    if (latestForCase && latestForCase.id !== row.id) {
      return { ok: true, refreshed: true, task: JSON.parse(latestForCase.resultJson ?? latestForCase.taskJson) as RemediationTaskView };
    }
    return { ok: false, error: "This approval was superseded by a newer one for the same case, but the current replacement could not be found -- ask ADASOS to re-diagnose and re-propose the fix." };
  }

  if (!REFRESHABLE_STATUSES.has(row.status)) {
    return { ok: false, error: `This approval is not awaiting a decision (status: "${row.status}") -- there is nothing to refresh.` };
  }

  const currentTask = JSON.parse(row.taskJson) as RemediationTaskView;
  const targetStatus = awaitingDecisionRowStatusFor(currentTask);
  if (row.status !== "expired" && row.expiresAt.getTime() >= Date.now()) {
    // Still genuinely valid -- nothing to do (Section 1: don't force a
    // refresh/replacement on an approval that's still well within its
    // production TTL).
    return { ok: true, refreshed: false, task: currentTask };
  }

  // Section 2/10: the same workspace/connection revalidation discipline
  // resolveRemediationApproval() itself already enforces -- refreshing
  // never re-executes anything, but reissuing a seemingly-actionable fresh
  // card bound to a connection that's since changed or been revoked would
  // only set the user up to approve something guaranteed to fail at
  // decision time. Refused here, honestly, instead.
  const connection = await db.gitHubConnection.findUnique({ where: { userId: workspaceId } });
  if (!connection || connection.id !== row.connectionId || connection.status !== "active") {
    return { ok: false, error: "The GitHub connection this approval was bound to is no longer active. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  const alreadyFresh = await db.remediationApproval.findFirst({
    where: { workspaceId, findingId: row.findingId, status: targetStatus, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (alreadyFresh && alreadyFresh.id !== row.id) {
    return { ok: true, refreshed: true, task: JSON.parse(alreadyFresh.taskJson) as RemediationTaskView };
  }

  // Genuinely expired, never decided, and no fresher replacement exists
  // yet -- reuse the SAME case (findingId, evidence, diagnosis, proposed
  // action/plan) with a new taskId, retire this row's audit trail entry,
  // and issue exactly one fresh replacement with a full, new TTL window.
  // `targetStatus` (derived from the ORIGINAL task's own finalStatus, not
  // this row's own possibly-already-"expired" status column) is what the
  // fresh replacement is issued at -- "expired" itself is never a status a
  // new, live approval should ever start out at.
  const freshTask: RemediationTaskView = { ...currentTask, taskId: randomUUID() };
  await db.$transaction([
    db.remediationApproval.update({ where: { id: row.id }, data: { status: "superseded", decidedAt: new Date() } }),
    db.remediationApproval.create({
      data: {
        workspaceId,
        taskId: freshTask.taskId,
        connectionId: row.connectionId,
        findingId: row.findingId,
        affectedResource: row.affectedResource,
        repositoryFullName: row.repositoryFullName,
        proposedAction: row.proposedAction,
        taskJson: JSON.stringify(freshTask),
        status: targetStatus,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    }),
  ]);

  return { ok: true, refreshed: true, task: freshTask };
}

export type RemediationApprovalResolution =
  | { readonly ok: true; readonly task: RemediationTaskView }
  | { readonly ok: false; readonly error: string };

/**
 * THE explicit, client-visible approval action (Section 5/6 of the
 * client-facing approval task) -- the only path that can ever move a real
 * production-affecting remediation forward. Never triggered by
 * conversational text; only by this function being called from a real
 * Approve/Reject button click.
 *
 * Re-validates, at decision time (not just at presentation time): the
 * approval belongs to this workspace, is still "pending" (no replay against
 * an already-decided or a different task -- Section 8), has not expired
 * (Section 7), and the GitHub connection it was bound to is still the
 * workspace's real, active one (refuses rather than silently executing
 * against a connection that changed since the approval was presented).
 */
/**
 * Maps a real RemediationTaskView.finalStatus to the RemediationApproval
 * row's own `status` string -- 1:1 for every status this row can
 * meaningfully reach ("planned"/"pending_approval"/"executing"/"verifying"
 * never do, since resolveRemediationApproval()/resumeVerificationAction()
 * only ever call this with resumeAfterApproval()/resumeVerification()'s own
 * real, already-final-for-now return value).
 */
function mapFinalStatusToApprovalStatus(finalStatus: string): string {
  switch (finalStatus) {
    case "resolved":
    case "rejected":
    case "verification_pending":
    case "failed_with_rollback":
    case "rollback_failed":
      return finalStatus;
    default:
      return "failed";
  }
}

/**
 * ROOT-SITE PROVISIONING CAPABILITY (2026-08-16), Sections 2/3-7/10: the
 * real decision handler for a provisioning approval -- reuses the EXACT
 * same expiry/connection-revalidation discipline resolveRemediationApproval()
 * itself already enforces (Section 10's "revalidate the connection before
 * mutation" requirement), then either records a clean rejection (no
 * repository ever touched) or runs the real, multi-step provisioning
 * execution via executeRootSiteProvisioning(). Never called for a normal
 * "pending" approval row -- resolveRemediationApproval() below branches to
 * this BEFORE its own "already decided" guard, since a provisioning row's
 * own status string ("root_site_provisioning_required") is deliberately
 * distinct from "pending".
 */
async function resolveRootSiteProvisioningDecision(
  workspaceId: string,
  row: { id: string; connectionId: string; taskJson: string; expiresAt: Date },
  decision: { readonly approved: boolean; readonly notes: string },
): Promise<RemediationApprovalResolution> {
  if (row.expiresAt.getTime() < Date.now()) {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "This approval has expired. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  const connection = await db.gitHubConnection.findUnique({ where: { userId: workspaceId } });
  if (!connection || connection.id !== row.connectionId || connection.status !== "active") {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "The GitHub connection this approval was bound to is no longer active. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  const task = JSON.parse(row.taskJson) as RemediationTaskView;

  if (!decision.approved) {
    const rejected: RemediationTaskView = { ...task, approvalState: "rejected", finalStatus: "rejected", failureReason: decision.notes };
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "rejected", resultJson: JSON.stringify(rejected), decidedAt: new Date() } });
    return { ok: true, task: rejected };
  }

  const modules = await getModules();
  const result = await executeRootSiteProvisioning(workspaceId, { ...task, approvalState: "approved" }, modules.verifyRobotsTxtLive);
  const approvalStatus = mapFinalStatusToApprovalStatus(result.finalStatus);

  await db.remediationApproval.update({
    where: { id: row.id },
    data: { status: approvalStatus, resultJson: JSON.stringify(result), decidedAt: result.finalStatus === "verification_pending" ? null : new Date() },
  });

  await db.remediationExecutionRecord.create({
    data: {
      remediationTaskId: result.taskId,
      userId: workspaceId,
      connectionId: row.connectionId,
      provider: "github",
      target: result.affectedResource,
      intendedChangesJson: JSON.stringify({ proposedAction: task.proposedAction, repositoryToCreate: task.rootSiteProvisioning?.repositoryToCreate ?? null }),
      approvalId: row.id,
      completedAt: result.finalStatus === "verification_pending" ? null : new Date(),
      result: result.finalStatus === "resolved" ? "success" : result.finalStatus === "verification_pending" ? "pending" : "failed",
      error: result.finalStatus === "resolved" || result.finalStatus === "verification_pending" ? null : result.failureReason,
      finalStatus: result.finalStatus,
    },
  });

  return { ok: true, task: result };
}

export async function resolveRemediationApproval(workspaceId: string, approvalId: string, decision: { readonly approved: boolean; readonly notes: string }): Promise<RemediationApprovalResolution> {
  // PHASE 2 PRODUCTION SECURITY & GOVERNANCE FIX (2026-08-18): the single,
  // real production-affecting-change decision gate this codebase has (see
  // this function's own header) is now also role-gated -- see
  // server/rbac.ts's own header for the real role model and why this is the
  // one enforcement point chosen. Checked BEFORE any row lookup so a
  // restricted role never learns anything about the approval's existence
  // or content either.
  const authorization = await assertAuthorized(workspaceId, decision.approved ? "approveRemediation" : "rejectRemediation");
  if (!authorization.ok) {
    return { ok: false, error: authorization.error };
  }

  const row = await db.remediationApproval.findFirst({ where: { id: approvalId, workspaceId } });
  if (!row) {
    return { ok: false, error: "This approval was not found for your workspace." };
  }
  if (row.status === "root_site_provisioning_required") {
    return resolveRootSiteProvisioningDecision(workspaceId, row, decision);
  }
  if (row.status !== "pending") {
    return { ok: false, error: `This approval has already been decided (status: "${row.status}").` };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "This approval has expired. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  const connection = await db.gitHubConnection.findUnique({ where: { userId: workspaceId } });
  if (!connection || connection.id !== row.connectionId || connection.status !== "active") {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "The GitHub connection this approval was bound to is no longer active. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  // REPOSITORY-SWITCH SAFETY FIX (2026-08-19): connectionId alone does not
  // prove "this approval still targets the currently connected repository"
  // -- selectGitHubRepository()/saveGitHubRepositorySelection() UPDATE the
  // SAME GitHubConnection row in place when a workspace switches which
  // repository is connected (live-confirmed in this project's own history:
  // the connectionId is unchanged across a repo switch, only
  // repositoryFullName is). Only reached for ordinary "pending" rows here
  // (root_site_provisioning_required already branched away above, where
  // row.repositoryFullName legitimately names a DIFFERENT repository --
  // the account's origin-root site to be created/used -- not the connected
  // project repo, so this check would misfire there and must not apply).
  // For an ordinary row, row.repositoryFullName was captured from
  // connection.repositoryFullName at creation time -- comparing it against
  // the CURRENT connection catches a stale, since-abandoned target
  // immediately, with no network call, rather than relying solely on a
  // live round-trip deep inside execute()'s own resourceIsCoveredByLiveUrl()
  // check to eventually catch it.
  if (connection.repositoryFullName !== row.repositoryFullName) {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "The connected repository has changed since this approval was created. Ask ADASOS to re-diagnose and re-propose the fix." };
  }

  const modules = await getModules();
  const task = JSON.parse(row.taskJson) as RemediationTaskView;
  const orchestrator = buildOrchestrator(modules);

  const result = await orchestrator.resumeAfterApproval(task, decision);

  // PRODUCTION HARDENING (2026-08-14): "verification_pending" is real and
  // resumable, not decided -- decidedAt is only set once a genuinely final
  // outcome exists (resolved/rejected/failed/failed_with_rollback/
  // rollback_failed), so a client re-checking this approval later can tell
  // "still propagating" from "actually done".
  const approvalStatus = mapFinalStatusToApprovalStatus(result.finalStatus);
  await db.remediationApproval.update({
    where: { id: row.id },
    data: { status: approvalStatus, resultJson: JSON.stringify(result), decidedAt: result.finalStatus === "verification_pending" ? null : new Date() },
  });

  // A structured execution audit record (Section 8's own requirement) is
  // only ever created for an ACTUAL attempted execution -- never for a
  // reject, where no adapter call happened at all. The RemediationApproval
  // row above is itself the complete audit record for a reject.
  // completedAt/result stay "pending" while verification_pending -- later
  // resumeVerificationAction() calls UPDATE this SAME record (never create
  // a duplicate) once a real, final outcome exists.
  if (decision.approved) {
    await db.remediationExecutionRecord.create({
      data: {
        remediationTaskId: result.taskId,
        userId: workspaceId,
        connectionId: row.connectionId,
        provider: "github",
        target: result.affectedResource,
        intendedChangesJson: JSON.stringify({ proposedAction: row.proposedAction }),
        approvalId: row.id,
        completedAt: result.finalStatus === "verification_pending" ? null : new Date(),
        result: result.finalStatus === "resolved" ? "success" : result.finalStatus === "verification_pending" ? "pending" : "failed",
        error: result.finalStatus === "resolved" || result.finalStatus === "verification_pending" ? null : result.failureReason,
        finalStatus: result.finalStatus,
      },
    });
  }

  return { ok: true, task: result };
}

/**
 * PRODUCTION HARDENING (2026-08-14), Section 5: THE real resume action for
 * a remediation left at "verification_pending" -- never re-executes, never
 * re-requests approval (guarded by requiring row.status ===
 * "verification_pending", mirroring resolveRemediationApproval()'s own
 * "already decided" guard for replay protection). Re-validates the
 * connection is still active, same discipline as resolveRemediationApproval().
 */
export async function resumeVerificationAction(workspaceId: string, approvalId: string): Promise<RemediationApprovalResolution> {
  const row = await db.remediationApproval.findFirst({ where: { id: approvalId, workspaceId } });
  if (!row) {
    return { ok: false, error: "This approval was not found for your workspace." };
  }
  if (row.status !== "verification_pending") {
    return { ok: false, error: `This remediation is not currently awaiting a verification resume (status: "${row.status}").` };
  }

  const connection = await db.gitHubConnection.findUnique({ where: { userId: workspaceId } });
  if (!connection || connection.id !== row.connectionId || connection.status !== "active") {
    await db.remediationApproval.update({ where: { id: row.id }, data: { status: "expired", decidedAt: new Date() } });
    return { ok: false, error: "The GitHub connection this remediation was bound to is no longer active. Manual review is required." };
  }

  const modules = await getModules();
  // resultJson (not taskJson) carries the LATEST real snapshot -- set by
  // resolveRemediationApproval() (or a previous resumeVerificationAction()
  // call) once the task first reached "verification_pending", including
  // its real rollbackData/verificationResumeCount so far.
  const task = JSON.parse(row.resultJson ?? row.taskJson) as RemediationTaskView;

  // ROOT-SITE PROVISIONING CAPABILITY (2026-08-16): a provisioning task's
  // verification round targets a repository the frozen orchestrator never
  // connected to (see this file's own header on why provisioning bypasses
  // RemediationOrchestrator entirely) -- resumed via the SAME
  // runProvisioningVerificationRound() the initial approval already ran,
  // never orchestrator.resumeVerification().
  const result = task.rootSiteProvisioning
    ? await runProvisioningVerificationRound({ ...task, verificationResumeCount: (task.verificationResumeCount ?? 0) + 1 }, modules.verifyRobotsTxtLive)
    : await buildOrchestrator(modules).resumeVerification(task);
  const approvalStatus = mapFinalStatusToApprovalStatus(result.finalStatus);

  await db.remediationApproval.update({
    where: { id: row.id },
    data: { status: approvalStatus, resultJson: JSON.stringify(result), decidedAt: result.finalStatus === "verification_pending" ? null : new Date() },
  });

  const existingRecord = await db.remediationExecutionRecord.findFirst({ where: { approvalId: row.id }, orderBy: { startedAt: "desc" } });
  if (existingRecord) {
    await db.remediationExecutionRecord.update({
      where: { id: existingRecord.id },
      data: {
        completedAt: result.finalStatus === "verification_pending" ? null : new Date(),
        result: result.finalStatus === "resolved" ? "success" : result.finalStatus === "verification_pending" ? "pending" : "failed",
        error: result.finalStatus === "resolved" || result.finalStatus === "verification_pending" ? null : result.failureReason,
        finalStatus: result.finalStatus,
      },
    });
  }

  return { ok: true, task: result };
}

/** Real, honest reply text for a RemediationTaskView -- never claims success the task's own finalStatus doesn't confirm. */
export function summarizeRemediationForChat(task: RemediationTaskView): string {
  const lines: string[] = [
    `**Diagnosis**: ${task.diagnosis}`,
    `**Evidence**: ${task.evidence}`,
    "",
  ];

  if (task.finalStatus === "resolved") {
    lines.push(
      `**Status: RESOLVED.** ADASOS applied the fix and verified it live.`,
      `**Live verification**: ${task.verificationEvidence}`,
    );
  } else if (task.finalStatus === "root_site_provisioning_required" && task.rootSiteProvisioning) {
    const plan = task.rootSiteProvisioning;
    lines.push(
      `**Status: ROOT-SITE PROVISIONING REQUIRED — APPROVAL REQUIRED.** No GitHub Pages repository controlling your account's origin root ("${plan.targetLiveUrl}") currently exists. ADASOS can create one and deploy the fix, but this is a real, production infrastructure change -- it never happens without your explicit approval.`,
      "",
      `**Why the connected repository can't fix this**: ${plan.reasonCurrentRepoCannotControl}`,
      `**Repository ADASOS would create**: ${plan.repositoryToCreate}`,
      `**GitHub Pages configuration required**: ${plan.pagesConfigurationRequired}`,
      `**File ADASOS would write (at the repository root)**: ${plan.fileToWrite}`,
      "```",
      plan.fileContent.trim(),
      "```",
      `**Execution/deployment risk**: ${plan.executionRisk}`,
      `**Live verification target**: ${plan.verificationUrl}`,
      "",
      "Review the details below and choose Approve or Reject before ADASOS creates anything in your GitHub account.",
    );
  } else if (task.finalStatus === "pending_approval") {
    lines.push(
      `**Status: APPROVAL REQUIRED.** This would make a real, production-affecting change to your connected GitHub repository -- ADASOS never applies it without your explicit approval.`,
      "",
      "**Proposed fix** -- the exact real content that would be written:",
      "```",
      task.proposedAction.trim(),
      "```",
      "",
      "Review the details below and choose Approve or Reject before ADASOS makes any change to your repository.",
    );
  } else if (task.finalStatus === "verification_pending") {
    // PRODUCTION HARDENING (2026-08-14): deliberately distinct from a real
    // failure -- the change was genuinely applied and deployed; live
    // verification just hasn't confirmed it YET, most often because the
    // real deployment is still propagating. Never says "failed".
    lines.push(
      `**Status: TREATMENT APPLIED, VERIFICATION STILL IN PROGRESS.** ADASOS committed and deployed the fix, but hasn't been able to confirm it live yet -- this is usually just deployment propagation taking a bit longer than the automatic check window.`,
      `**Current live state**: ${task.verificationEvidence ?? "No live check has returned evidence yet."}`,
      "",
      "This has not failed -- ask ADASOS to check again in a minute, or use the Check again action, to resume verification without re-applying the change.",
    );
  } else if (task.finalStatus === "failed_with_rollback") {
    lines.push(
      `**Status: FAILED — AUTOMATICALLY ROLLED BACK.** Live verification did not confirm the fix within the available checks, so ADASOS automatically reverted the real change it made -- your repository should now match its state before this remediation.`,
      `**Reason**: ${task.failureReason ?? "See details above."}`,
    );
  } else if (task.finalStatus === "rollback_failed") {
    lines.push(
      `**Status: FAILED — AUTOMATIC ROLLBACK ALSO FAILED.** Live verification did not confirm the fix, and ADASOS's automatic attempt to revert the real change also failed -- the change may still be live in your repository. This needs manual review.`,
      `**Reason**: ${task.failureReason ?? "See details above."}`,
    );
  } else {
    lines.push(
      `**Status: ${task.finalStatus.toUpperCase()}.** ADASOS could not complete this automatically.`,
      `**Reason**: ${task.failureReason ?? "See details above."}`,
      "",
      "**Proposed fix (ready to use)** -- the exact real file content this remediation would apply:",
      "```",
      task.proposedAction.trim(),
      "```",
    );
    if (task.verificationEvidence) {
      lines.push("", `**Current live state**: ${task.verificationEvidence}`);
    }
  }

  return lines.join("\n");
}
