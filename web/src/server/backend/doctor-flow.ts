// DOCTOR FLOW COMPLETION (2026-08-21): the AUDIT -> ALL FINDINGS ->
// PRIORITIZATION -> STRATEGY -> APPROVAL -> EXECUTION -> RE-AUDIT ->
// BEFORE/AFTER -> REPORT loop this module completes. Every piece here is
// purely ADDITIVE to the existing, already-tested Phase 5 orchestration --
// nothing in route.ts's existing gating, timing, or approval mechanism is
// changed; this module only adds what genuinely didn't exist before:
//   1. runFullReAudit() -- a real second runFullAudit() call against the
//      SAME url, only ever invoked after a genuine execution attempt.
//   2. compareAudits() -- a real, non-fabricated diff between two real
//      FullAuditResult finding lists (fixed / remaining / newly detected),
//      never assumed or guessed.
//   3. buildDoctorFlowReport()/summarizeDoctorFlowForChat() -- assembles
//      the complete before/after picture (original findings, priority
//      ranking, remediation strategy, approval status, executed changes,
//      execution result, post-fix audit, comparison, remaining/failed/
//      blocked items) into one real, reportable structure.
//
// Re-audit only ever runs after a genuine EXECUTION ATTEMPT (approved and
// actually run against the real repository -- resolved/failed/
// failed_with_rollback/rollback_failed). A rejected decision or a
// not-yet-decided pending approval never triggers a re-audit: nothing could
// have changed, so re-auditing would be a redundant, wasted crawl, not a
// genuine verification. This mirrors the same "never fabricate a check that
// wouldn't prove anything" discipline every other real check in this
// codebase follows.

import { runFullAudit, type FullAuditResult } from "@/server/backend/website-audit";
import type { AuditFinding } from "@/server/backend/types";
import type { RemediationTaskView, PrioritizedFinding, UnsupportedFinding } from "@/server/backend/remediation";

/** finalStatus values that mean a real write was genuinely attempted against the repository -- whether it ultimately succeeded or not. Distinct from "pending_approval"/"root_site_provisioning_required" (no decision yet) and "rejected"/"blocked" (no execution ever attempted). */
const EXECUTION_ATTEMPTED_STATUSES = new Set(["resolved", "failed", "failed_with_rollback", "rollback_failed"]);

export function taskReachedExecutionAttempt(task: RemediationTaskView | null): boolean {
  return task !== null && EXECUTION_ATTEMPTED_STATUSES.has(task.finalStatus);
}

export type VerificationStatus = "VERIFIED_IMPROVED" | "NO_CHANGE" | "REGRESSED" | "MIXED_NOT_VERIFIED";

export interface AuditComparison {
  readonly fixedFindings: readonly AuditFinding[];
  readonly remainingFindings: readonly AuditFinding[];
  readonly newlyDetectedFindings: readonly AuditFinding[];
  readonly verificationStatus: VerificationStatus;
}

function findingKey(finding: AuditFinding): string {
  return `${finding.category}::${finding.message}`;
}

/** Real, non-fabricated diff between two real audit finding lists -- never assumes an outcome, only reports what genuinely changed. */
export function compareAudits(before: FullAuditResult, after: FullAuditResult): AuditComparison {
  const beforeFindings = before.websiteAudit.findings;
  const afterFindings = after.websiteAudit.findings;
  const afterKeys = new Set(afterFindings.map(findingKey));
  const beforeKeys = new Set(beforeFindings.map(findingKey));

  const fixedFindings = beforeFindings.filter((finding) => !afterKeys.has(findingKey(finding)));
  const remainingFindings = beforeFindings.filter((finding) => afterKeys.has(findingKey(finding)));
  const newlyDetectedFindings = afterFindings.filter((finding) => !beforeKeys.has(findingKey(finding)));

  let verificationStatus: VerificationStatus;
  if (fixedFindings.length > 0 && newlyDetectedFindings.length === 0) {
    verificationStatus = "VERIFIED_IMPROVED";
  } else if (fixedFindings.length === 0 && newlyDetectedFindings.length === 0) {
    verificationStatus = "NO_CHANGE";
  } else if (fixedFindings.length === 0 && newlyDetectedFindings.length > 0) {
    verificationStatus = "REGRESSED";
  } else {
    verificationStatus = "MIXED_NOT_VERIFIED";
  }

  return { fixedFindings, remainingFindings, newlyDetectedFindings, verificationStatus };
}

/** A real, second, complete runFullAudit() call against the SAME url -- never a narrow single-resource check standing in for a full re-audit. */
export async function runFullReAudit(siteUrl: string): Promise<FullAuditResult> {
  return runFullAudit(siteUrl, "");
}

/** Real, non-fabricated FIXED/NOT FIXED verdict derived from a genuine compareAudits() result -- FIXED only when the comparison proves at least one original finding is gone and nothing new was introduced; every other real outcome (nothing changed, a regression, or a mixed result) is honestly NOT FIXED, never assumed. */
export function deriveFixVerdict(comparison: AuditComparison): "FIXED" | "NOT FIXED" {
  return comparison.verificationStatus === "VERIFIED_IMPROVED" ? "FIXED" : "NOT FIXED";
}

/**
 * Real, non-fabricated chat-facing summary of a single re-audit verification
 * pass for a fix that was executed OUTSIDE Boss's own orchestrated workflow
 * (e.g. a directly-assigned technical-seo-agent/website-audit-agent request
 * such as "fix the canonical tag") -- deliberately smaller than
 * summarizeDoctorFlowForChat()/DoctorFlowReport, which carries priority
 * ranking and remediation-strategy framing that only makes sense for a
 * Boss-owned end-to-end workflow. Every field here traces directly to a
 * real compareAudits() result -- no LLM, nothing assumed.
 */
export function summarizeReAuditVerificationForChat(url: string, comparison: AuditComparison): string {
  const verdict = deriveFixVerdict(comparison);
  const lines = [
    `**Re-audit verification for ${url}: ${verdict}**`,
    `- Fixed: ${comparison.fixedFindings.length}`,
    `- Remaining: ${comparison.remainingFindings.length}`,
    `- Newly detected: ${comparison.newlyDetectedFindings.length}`,
    `- Verification status: ${comparison.verificationStatus}`,
  ];
  if (comparison.remainingFindings.length > 0) {
    lines.push("", "**Still present (not resolved):**");
    for (const finding of comparison.remainingFindings.slice(0, 5)) {
      lines.push(`- [${finding.severity}] (${finding.category}) ${finding.message}`);
    }
  }
  if (comparison.newlyDetectedFindings.length > 0) {
    lines.push("", "**Newly detected (regression):**");
    for (const finding of comparison.newlyDetectedFindings.slice(0, 5)) {
      lines.push(`- [${finding.severity}] (${finding.category}) ${finding.message}`);
    }
  }
  return lines.join("\n");
}

export interface DoctorFlowReport {
  readonly url: string;
  readonly originalFindings: readonly AuditFinding[];
  readonly priorityRanking: readonly PrioritizedFinding[];
  readonly remediationStrategy: {
    readonly attempted: RemediationTaskView | null;
    readonly unsupportedFindings: readonly UnsupportedFinding[];
  };
  readonly humanApprovalStatus: string;
  readonly executedChanges: string | null;
  readonly executionResult: string;
  readonly postFixAudit: FullAuditResult | null;
  readonly comparison: AuditComparison | null;
  readonly failedFixes: readonly string[];
  readonly blockedFixes: readonly string[];
  readonly remainingProblems: readonly AuditFinding[];
  readonly decidedAt: string;
}

/**
 * Assembles the complete Doctor Flow report. `task` is the SAME real
 * RemediationTaskView runRemediationFromAuditFindings() produced this turn
 * (or a later turn's decision on the same case) -- never fabricated. When
 * `task` never reached a genuine execution attempt (still pending a human
 * decision, rejected, or blocked/not-remediable), this honestly reports
 * "no execution occurred" and skips the re-audit/comparison entirely --
 * re-auditing would prove nothing if nothing was actually changed.
 */
export async function buildDoctorFlowReport(
  siteUrl: string,
  originalAudit: FullAuditResult,
  prioritizedFindings: readonly PrioritizedFinding[],
  unsupportedFindings: readonly UnsupportedFinding[],
  task: RemediationTaskView | null,
): Promise<DoctorFlowReport> {
  const decidedAt = new Date().toISOString();

  if (task === null || !taskReachedExecutionAttempt(task)) {
    return {
      url: siteUrl,
      originalFindings: originalAudit.websiteAudit.findings,
      priorityRanking: prioritizedFindings,
      remediationStrategy: { attempted: task, unsupportedFindings },
      humanApprovalStatus: task ? task.finalStatus : "not_applicable_no_supported_finding_required_a_fix",
      executedChanges: null,
      executionResult: task ? (task.failureReason ?? `No execution occurred (status: ${task.finalStatus}).`) : "No supported finding required remediation.",
      postFixAudit: null,
      comparison: null,
      failedFixes: [],
      blockedFixes: task && task.finalStatus === "blocked" ? [task.failureReason ?? "Blocked -- no further detail recorded."] : [],
      remainingProblems: originalAudit.websiteAudit.findings,
      decidedAt,
    };
  }

  const postFixAudit = await runFullReAudit(siteUrl);
  const comparison = compareAudits(originalAudit, postFixAudit);

  const failedFixes = task.finalStatus === "failed" || task.finalStatus === "failed_with_rollback" || task.finalStatus === "rollback_failed" ? [task.failureReason ?? task.diagnosis] : [];

  return {
    url: siteUrl,
    originalFindings: originalAudit.websiteAudit.findings,
    priorityRanking: prioritizedFindings,
    remediationStrategy: { attempted: task, unsupportedFindings },
    humanApprovalStatus: task.finalStatus,
    executedChanges: task.proposedAction,
    executionResult: task.failureReason ?? task.finalStatus,
    postFixAudit,
    comparison,
    failedFixes,
    blockedFixes: [],
    remainingProblems: comparison.remainingFindings,
    decidedAt,
  };
}

/** Real, non-fabricated chat-facing summary of the complete DoctorFlowReport -- no LLM, every field traced directly to the report's own real data. */
export function summarizeDoctorFlowForChat(report: DoctorFlowReport): string {
  const lines: string[] = [
    `**Doctor Flow report for ${report.url}**`,
    "",
    `Original findings: ${report.originalFindings.length} (priority-ranked below).`,
  ];

  if (report.priorityRanking.length > 0) {
    lines.push("", "**Priority ranking (top 5):**");
    for (const finding of report.priorityRanking.slice(0, 5)) {
      lines.push(`${finding.priorityRank}. [${finding.severity}] (${finding.category}) ${finding.message}`);
    }
  }

  lines.push("", `**Human Approval status**: ${report.humanApprovalStatus}`);
  lines.push(`**Execution result**: ${report.executionResult}`);

  if (report.remediationStrategy.unsupportedFindings.length > 0) {
    lines.push("", `**Unsupported findings** (${report.remediationStrategy.unsupportedFindings.length} -- no automated remediation exists, marked explicitly rather than fabricated as fixed):`);
    for (const finding of report.remediationStrategy.unsupportedFindings.slice(0, 5)) {
      lines.push(`- [${finding.severity}] (${finding.category}) ${finding.message}`);
    }
  }

  if (report.postFixAudit && report.comparison) {
    lines.push(
      "",
      "**Full re-audit completed.** Before/after comparison:",
      `- Fixed: ${report.comparison.fixedFindings.length}`,
      `- Remaining: ${report.comparison.remainingFindings.length}`,
      `- Newly detected: ${report.comparison.newlyDetectedFindings.length}`,
      `- Verification status: ${report.comparison.verificationStatus}`,
    );
  } else {
    lines.push("", "No execution occurred this turn, so no re-audit was run (nothing could have changed).");
  }

  if (report.failedFixes.length > 0) {
    lines.push("", `**Failed fixes**: ${report.failedFixes.join("; ")}`);
  }
  if (report.blockedFixes.length > 0) {
    lines.push("", `**Blocked fixes**: ${report.blockedFixes.join("; ")}`);
  }

  return lines.join("\n");
}
