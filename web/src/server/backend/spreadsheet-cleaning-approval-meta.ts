// SPREADSHEET CLEANING APPROVAL META (2026-09-15, extracted): SpreadsheetProcessingResult /
// SpreadsheetCleaningApprovalMeta / buildSpreadsheetCleaningApprovalMeta() used to live in
// spreadsheet-processing.ts, which also imports the Google Sheets WRITE-BACK path
// (getWriteDestinationSpreadsheet from @/server/google-sheets, writeApprovedCleaningToGoogleSheets from
// spreadsheet-google-sheets-writeback.ts) for its own approve/reject handling. That made every READ-ONLY
// consumer of these three exports (google-sheets-cleaning.ts's processSelectedGoogleSheet(), which only
// ever reads -- see that file's own header) transitively depend on the write-back module and, through it,
// on @/server/google-sheets' currently-uncommitted credential-encryption migration -- a dependency the
// read-only live-sheet cleaning path has no actual use for. Moved here, on their own, with no import
// beyond spreadsheet-cleaning-approval.ts's own CleaningApprovalRecord type, so a read-only caller no
// longer needs the write-back/encryption chain at all. spreadsheet-processing.ts now imports these three
// from here too -- same exports, same behavior, one less unnecessary edge in the dependency graph.

import type { CleaningApprovalRecord } from "./spreadsheet-cleaning-approval";

/** Real, display-only summary of a pending/decided cleaning approval -- attached to ChatMessage.metaJson so workspace-shell.tsx can render a real, clickable Review/Approve/Reject card (see SpreadsheetCleaningApprovalCard) instead of relying on a plain-text "reply approve" instruction alone. Never includes retainedRows/resultJson -- only counts and the two authenticated download URLs. */
export interface SpreadsheetCleaningApprovalMeta {
  readonly id: string;
  readonly status: "pending_approval" | "approved" | "rejected" | "written" | "write_failed";
  readonly originalFileName: string;
  readonly originalRowCount: number;
  readonly retainedRowCount: number;
  readonly exactDuplicateGroupCount: number;
  readonly exactDuplicateRowCount: number;
  readonly domainDuplicateGroupCount: number;
  readonly domainDuplicateRowCount: number;
  readonly malformedCount: number;
  readonly incompleteCount: number;
  readonly manualReviewCount: number;
  readonly cleanedFileUrl: string;
  readonly auditFileUrl: string;
}

export interface SpreadsheetProcessingResult {
  readonly ok: boolean;
  readonly reply: string;
  readonly approvalMeta?: SpreadsheetCleaningApprovalMeta;
}

/** Builds the real, display-only card metadata from an already-persisted CleaningApprovalRecord -- reused both right after processing and by the session-reload route (workspace/sessions/[id]/route.ts), which looks up the live, current approval state by attachmentId rather than trusting a frozen metaJson snapshot -- see that route's own comment on why. */
export function buildSpreadsheetCleaningApprovalMeta(originalFileName: string, approval: CleaningApprovalRecord): SpreadsheetCleaningApprovalMeta {
  const result = approval.result;
  return {
    id: approval.id,
    status: approval.status,
    originalFileName,
    originalRowCount: result.originalRowCount,
    retainedRowCount: result.retainedRowIndexes.length,
    exactDuplicateGroupCount: result.exactDuplicateGroups.length,
    exactDuplicateRowCount: result.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0),
    domainDuplicateGroupCount: result.domainDuplicateGroups.length,
    domainDuplicateRowCount: result.domainDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0),
    malformedCount: result.malformedUrlRows.length,
    incompleteCount: result.incompleteRows.length,
    manualReviewCount: result.manualReviewRowIndexes.length,
    cleanedFileUrl: `/api/spreadsheet-cleaning/${approval.id}/cleaned`,
    auditFileUrl: `/api/spreadsheet-cleaning/${approval.id}/audit`,
  };
}
