// SPREADSHEET CLEANING APPROVAL GATE (2026-09-02): a real, persistent human-approval gate between a
// locally-computed CleaningResult (spreadsheet-cleaning.ts) and any write to the user's own Google
// Sheets. Mirrors the established RemediationApproval pattern's SHAPE (workspace-scoped, a real status
// lifecycle, decided at most once, the exact approved content re-used verbatim at execution time -- never
// re-derived) via its own dedicated SpreadsheetCleaningApproval model, since RemediationApproval's own
// fields are GitHub-remediation specific. NOTHING in this file ever calls the Google Sheets API --
// writeApprovedCleaningToGoogleSheets() in spreadsheet-google-sheets-writeback.ts is the only place that
// does, and it refuses to run against anything but an "approved" row from here.

import { db } from "@/server/db";
import type { CleaningResult } from "./spreadsheet-cleaning";

export interface CleaningApprovalRecord {
  readonly id: string;
  readonly userId: string;
  readonly attachmentId: string;
  readonly status: "pending_approval" | "approved" | "rejected" | "written" | "write_failed";
  readonly result: CleaningResult;
  readonly createdAt: string;
  /** Per-tab write-retry tracking (2026-09-03) -- null means that tab has never been successfully written by any attempt yet. See spreadsheet-google-sheets-writeback.ts's own header for why this exists. */
  readonly adminVendorWrittenAt: string | null;
  readonly clientWebsitesWrittenAt: string | null;
}

function toRecord(row: {
  id: string;
  userId: string;
  attachmentId: string;
  status: string;
  resultJson: string;
  createdAt: Date;
  adminVendorWrittenAt: Date | null;
  clientWebsitesWrittenAt: Date | null;
}): CleaningApprovalRecord {
  return {
    id: row.id,
    userId: row.userId,
    attachmentId: row.attachmentId,
    status: row.status as CleaningApprovalRecord["status"],
    result: JSON.parse(row.resultJson) as CleaningResult,
    createdAt: row.createdAt.toISOString(),
    adminVendorWrittenAt: row.adminVendorWrittenAt ? row.adminVendorWrittenAt.toISOString() : null,
    clientWebsitesWrittenAt: row.clientWebsitesWrittenAt ? row.clientWebsitesWrittenAt.toISOString() : null,
  };
}

/** Persists a real, already-computed CleaningResult as a new pending approval -- the exact snapshot a human will review; approval/write always re-read THIS row, never recompute. */
export async function createPendingCleaningApproval(userId: string, attachmentId: string, result: CleaningResult): Promise<CleaningApprovalRecord> {
  const row = await db.spreadsheetCleaningApproval.create({
    data: { userId, attachmentId, status: "pending_approval", resultJson: JSON.stringify(result) },
  });
  return toRecord(row);
}

/** Real, ownership-scoped lookup of this user's single most recent PENDING approval for a given attachment -- never another workspace's, never an already-decided one. */
export async function getPendingCleaningApproval(userId: string, attachmentId: string): Promise<CleaningApprovalRecord | null> {
  const row = await db.spreadsheetCleaningApproval.findFirst({
    where: { userId, attachmentId, status: "pending_approval" },
    orderBy: { createdAt: "desc" },
  });
  return row ? toRecord(row) : null;
}

/** Real, ownership-scoped lookup of this user's single most recent approval for a given attachment, REGARDLESS of status (pending/approved/rejected/written) -- used by the session-reload route to show the LIVE, current state (including a decision made after the message was first created) rather than trusting the ChatMessage's own frozen metaJson snapshot from creation time. */
export async function getMostRecentCleaningApprovalForAttachment(userId: string, attachmentId: string): Promise<CleaningApprovalRecord | null> {
  const row = await db.spreadsheetCleaningApproval.findFirst({
    where: { userId, attachmentId },
    orderBy: { createdAt: "desc" },
  });
  return row ? toRecord(row) : null;
}

/** Real, ownership-scoped lookup of this user's single most recent PENDING approval across ANY attachment -- used to resolve a bare "yes, approve it" chat reply that doesn't repeat the filename. */
export async function getMostRecentPendingCleaningApproval(userId: string): Promise<CleaningApprovalRecord | null> {
  const row = await db.spreadsheetCleaningApproval.findFirst({
    where: { userId, status: "pending_approval" },
    orderBy: { createdAt: "desc" },
  });
  return row ? toRecord(row) : null;
}

/** Real, ownership-scoped lookup of ONE specific approval by its own id, REGARDLESS of status -- used by the "retry write" action, which must operate on the exact record the user is looking at, not merely "the most recent one". */
export async function getCleaningApprovalById(userId: string, approvalId: string): Promise<CleaningApprovalRecord | null> {
  const row = await db.spreadsheetCleaningApproval.findFirst({ where: { id: approvalId, userId } });
  return row ? toRecord(row) : null;
}

export interface ApprovalDecisionResult {
  readonly ok: boolean;
  readonly record?: CleaningApprovalRecord;
  readonly error?: string;
}

/** Ownership-scoped: marks a real, still-pending approval "approved" -- refuses (never silently no-ops) if it's missing, belongs to another workspace, or was already decided. */
export async function approveCleaningApproval(userId: string, approvalId: string): Promise<ApprovalDecisionResult> {
  const existing = await db.spreadsheetCleaningApproval.findFirst({ where: { id: approvalId, userId } });
  if (!existing) return { ok: false, error: "No such pending cleaning approval for this workspace." };
  if (existing.status !== "pending_approval") return { ok: false, error: `This approval was already decided (status: ${existing.status}).` };
  const updated = await db.spreadsheetCleaningApproval.update({ where: { id: approvalId }, data: { status: "approved", decidedAt: new Date() } });
  return { ok: true, record: toRecord(updated) };
}

/** Ownership-scoped: marks a real, still-pending approval "rejected" -- the clean dataset is discarded (never written anywhere); the original file is untouched either way. */
export async function rejectCleaningApproval(userId: string, approvalId: string): Promise<ApprovalDecisionResult> {
  const existing = await db.spreadsheetCleaningApproval.findFirst({ where: { id: approvalId, userId } });
  if (!existing) return { ok: false, error: "No such pending cleaning approval for this workspace." };
  if (existing.status !== "pending_approval") return { ok: false, error: `This approval was already decided (status: ${existing.status}).` };
  const updated = await db.spreadsheetCleaningApproval.update({ where: { id: approvalId }, data: { status: "rejected", decidedAt: new Date() } });
  return { ok: true, record: toRecord(updated) };
}

/** Eligible starting states for a real Google Sheets write attempt: a fresh approval, or a retry of one whose previous attempt genuinely failed. Never "pending_approval"/"rejected"/"written" -- those are refused explicitly below. */
const WRITE_ELIGIBLE_STATUSES: readonly string[] = ["approved", "write_failed"];

/** Ownership-scoped: marks an approved (or previously write_failed, on a successful retry) row "written" -- called ONLY after a real, confirmed successful Sheets API response for every applicable tab. Never called on approval alone. */
export async function markCleaningApprovalWritten(userId: string, approvalId: string): Promise<ApprovalDecisionResult> {
  const existing = await db.spreadsheetCleaningApproval.findFirst({ where: { id: approvalId, userId } });
  if (!existing) return { ok: false, error: "No such cleaning approval for this workspace." };
  if (!WRITE_ELIGIBLE_STATUSES.includes(existing.status)) {
    return { ok: false, error: `Cannot mark as written -- this approval's status is "${existing.status}".` };
  }
  const updated = await db.spreadsheetCleaningApproval.update({ where: { id: approvalId }, data: { status: "written" } });
  return { ok: true, record: toRecord(updated) };
}

/**
 * WRITE-RESULT STATE FIX (2026-09-03): a real, live-confirmed defect -- a failed Google Sheets write left
 * the approval row's status at "approved" forever, with no persisted signal that a write was even
 * attempted, let alone that it failed. The Workspace card showed a plain green "Approved" badge with no
 * retry action, while the destination spreadsheet stayed empty. Ownership-scoped: marks a real write
 * attempt's failure -- callable from "approved" (first attempt failed) or "write_failed" (a retry also
 * failed) -- never from "written" (a confirmed success can never be silently downgraded to a failure).
 */
export async function markCleaningApprovalWriteFailed(userId: string, approvalId: string): Promise<ApprovalDecisionResult> {
  const existing = await db.spreadsheetCleaningApproval.findFirst({ where: { id: approvalId, userId } });
  if (!existing) return { ok: false, error: "No such cleaning approval for this workspace." };
  if (!WRITE_ELIGIBLE_STATUSES.includes(existing.status)) {
    return { ok: false, error: `Cannot mark as write-failed -- this approval's status is "${existing.status}".` };
  }
  const updated = await db.spreadsheetCleaningApproval.update({ where: { id: approvalId }, data: { status: "write_failed" } });
  return { ok: true, record: toRecord(updated) };
}

/**
 * PER-TAB WRITE TRACKING (2026-09-03): real retry-safety -- called immediately after ONE tab's real
 * append call succeeds (never batched until the end), so a later retry can tell exactly which tab(s)
 * genuinely still need writing and skip the one(s) that already succeeded, preventing duplicate rows.
 * Ownership-scoped via a WHERE clause rather than a separate existence check -- an update matching zero
 * rows (wrong owner/id) is a silent no-op here by design, since this is an internal bookkeeping step
 * during an already ownership-verified write attempt, not a user-facing decision.
 */
export async function markSpreadsheetTabWritten(userId: string, approvalId: string, tab: "adminVendor" | "clientWebsites"): Promise<void> {
  const field = tab === "adminVendor" ? "adminVendorWrittenAt" : "clientWebsitesWrittenAt";
  await db.spreadsheetCleaningApproval.updateMany({ where: { id: approvalId, userId }, data: { [field]: new Date() } });
}
