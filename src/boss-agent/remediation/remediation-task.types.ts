// The real, structured remediation task model -- per this task's own Rule 2
// ("Do not use plain conversational text as the only source of remediation
// state"). Every field is either supplied by real, already-verified evidence
// (a real audit finding, real crawl data) or advances through a small,
// explicit, one-way state machine -- see remediation-lifecycle.ts for the
// transition functions. Objects are immutable; every transition returns a
// NEW task (the same convention RoutingDecision already uses throughout this
// codebase), so a task's own history can be reconstructed from its
// updatedAt-ordered snapshots rather than mutated in place.

/**
 * The task's own terminal/in-progress status. Distinct from `approvalState`/
 * `executionState`/`verificationState` (which track sub-phases independently
 * so a caller can tell exactly where a BLOCKED or FAILED task stopped)--
 * `finalStatus` is the single field a caller checks for "is this task done,
 * and how".
 */
export type RemediationFinalStatus =
  | "planned"
  | "pending_approval"
  | "executing"
  | "verifying"
  /**
   * PRODUCTION HARDENING (2026-08-14): a genuinely real, resumable state --
   * the bounded verification retry window closed WITHOUT the live check
   * passing, but also without a definitive, terminal signal (see
   * verificationResumeCount/maxVerificationResumes below). A real
   * deployment (GitHub Pages or any real static host) can genuinely take
   * longer to propagate than any single bounded window can safely wait for
   * inside one synchronous request -- this state means "not confirmed YET",
   * distinct from "confirmed broken". Never triggers rollback on its own;
   * only resumeVerification() reaching its OWN resume budget can produce a
   * genuinely terminal "failed".
   */
  | "verification_pending"
  | "resolved"
  | "blocked"
  | "failed"
  /** Terminal verification failure, and the automatic rollback that followed it succeeded (real commit reverted, real read-back confirmed). Never a fabricated recovery -- the remediation itself is still "not resolved". */
  | "failed_with_rollback"
  /** Terminal verification failure, AND the automatic rollback attempt itself also failed (or no rollback data/capability was available) -- the real change may still be live. Requires manual intervention; never silently retried. */
  | "rollback_failed"
  | "rejected";

export type RemediationApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type RemediationExecutionState = "not_started" | "blocked" | "in_progress" | "completed" | "failed";
export type RemediationVerificationState = "not_started" | "in_progress" | "pending" | "passed" | "failed";

/**
 * Real, captured pre-change state -- exists only once EXECUTE has actually
 * committed a real change (see GitHubRepositoryAdapter.execute()'s own real
 * capture). `previousContent: null` means the file genuinely did not exist
 * before this remediation (rollback = delete); a real string means it
 * existed with this real content (rollback = restore). Never invented --
 * always the real content/sha read immediately before the real commit that
 * changed it.
 */
export interface RemediationRollbackData {
  readonly path: string;
  readonly branch: string;
  readonly previousContent: string | null;
  readonly previousSha: string | null;
}

export interface RemediationTask {
  readonly taskId: string;
  /** Client/workspace this task belongs to -- see the client-isolation requirement this field exists to satisfy. Never shared across workspaces. */
  readonly workspaceId: string;
  /** Stable id for the real audit finding this task remediates (see robots-txt-remediation-planner.ts for how this is derived -- never invented). */
  readonly findingId: string;
  /** The real URL/resource this task acts on. */
  readonly affectedResource: string;
  /** The real, verified evidence the finding is based on (e.g. "Live fetch of /robots.txt returned HTTP 404 at <timestamp>."). Never a guess. */
  readonly evidence: string;
  /** Plain-language diagnosis, grounded in the evidence above. */
  readonly diagnosis: string;
  /** The capability class this remediation needs -- see src/boss-agent/routing/capability-classifier.ts's CapabilityClass. */
  readonly requiredCapability: string;
  /** The specific real tool/access this remediation needs (e.g. "repository-file-write-and-deploy"). */
  readonly requiredTool: string;
  /** The real, ready-to-use proposed change (e.g. the literal robots.txt content to add) -- never a placeholder. */
  readonly proposedAction: string;
  readonly approvalState: RemediationApprovalState;
  readonly executionState: RemediationExecutionState;
  readonly verificationState: RemediationVerificationState;
  readonly retryCount: number;
  readonly maxRetries: number;
  /** How many separate resumeVerification() rounds have already run after the initial bounded-retry window closed without a pass. 0 until the task first reaches "verification_pending". */
  readonly verificationResumeCount: number;
  /** Bounded resume budget (PRODUCTION HARDENING, 2026-08-14) -- resumeVerification() refuses to run once this is reached, instead producing a genuinely terminal "failed" (which triggers automatic rollback). Never unbounded -- "resumable" does not mean "infinite". */
  readonly maxVerificationResumes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalStatus: RemediationFinalStatus;
  /** Set whenever finalStatus is "blocked"/"failed"/"failed_with_rollback"/"rollback_failed"/"rejected" -- the real, specific reason, never generic. */
  readonly failureReason: string | null;
  /** Real evidence from the live re-check after an attempted fix (see live-verifier.ts) -- null until a verification attempt has actually run. */
  readonly verificationEvidence: string | null;
  /** Real, captured pre-change state -- null until EXECUTE has actually committed a real change. Used by automatic rollback on genuine terminal verification failure; never present for a task that never reached real execution. */
  readonly rollbackData: RemediationRollbackData | null;
}
