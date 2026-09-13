// SPREADSHEET PROCESSING CAPABILITY (2026-09-02, extended for the full cleaning workflow): the real,
// local execution behind google-sheets-integration-agent's assignment for an uploaded XLSX/XLS/CSV
// attachment -- see tag-weighted-routing-strategy.ts's own hasSpreadsheetProcessingIntent() header for
// why this agent is the target, and workspace/messages/route.ts's own dispatch branches for exactly when
// each part of this runs. Retrieves the real, already-uploaded, ownership-checked attachment bytes
// (attachments.ts's retrieveAttachmentFile()) and parses + cleans them ENTIRELY LOCALLY
// (spreadsheet-reader.ts + spreadsheet-cleaning.ts) -- never sends file bytes to Anthropic/Gemini/
// DataForSEO/Google/any external service. Read-only on the original file: never rewrites, mutates, or
// deletes it. Never fabricates a worksheet/column/row/value that isn't really there. The computed
// CleaningResult is persisted as a real, pending SpreadsheetCleaningApproval row -- NOTHING is ever
// written to Google Sheets from this file; see spreadsheet-google-sheets-writeback.ts for the one place
// that can, and only once a human has explicitly approved.

import { retrieveAttachmentFile, type AttachmentMeta } from "./attachments";
import { readSpreadsheet, type SpreadsheetReadResult } from "./spreadsheet-reader";
import { buildCleaningResult, buildCleaningAuditCsv, type CleaningResult } from "./spreadsheet-cleaning";
import { buildXlsxWorkbook } from "./xlsx-writer";
import { mapToFinalBusinessSchema, splitByOrganicTraffic, ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME, BUSINESS_SCHEMA_COLUMN_WIDTHS, BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS } from "./spreadsheet-business-schema";
import {
  createPendingCleaningApproval,
  getMostRecentPendingCleaningApproval,
  approveCleaningApproval,
  rejectCleaningApproval,
  type CleaningApprovalRecord,
} from "./spreadsheet-cleaning-approval";
import { saveCleaningArtifacts } from "./spreadsheet-cleaning-artifacts";
import { writeApprovedCleaningToGoogleSheets } from "./spreadsheet-google-sheets-writeback";
import { getWriteDestinationSpreadsheet } from "@/server/google-sheets";
import { buildSpreadsheetCleaningApprovalMeta, type SpreadsheetCleaningApprovalMeta, type SpreadsheetProcessingResult } from "./spreadsheet-cleaning-approval-meta";

export type { SpreadsheetCleaningApprovalMeta, SpreadsheetProcessingResult } from "./spreadsheet-cleaning-approval-meta";
export { buildSpreadsheetCleaningApprovalMeta } from "./spreadsheet-cleaning-approval-meta";

// HARD COST-PROTECTION GUARD (2026-09-02): a real, live-confirmed production-safety requirement -- a
// spreadsheet-only task was repeatedly diverted into Boss's orchestrated SEO/remediation pipeline by
// classifier/routing phrase-list gaps (see task-intent-classifier.ts's and tag-weighted-routing-
// strategy.ts's own headers for the two specific gaps already fixed), which then reached an
// Anthropic-backed specialist reply and incurred a real external API call for a task that should never
// have needed one. This function is a DELIBERATELY SEPARATE, redundant check from routing's own
// hasSpreadsheetProcessingIntent() -- not because the logic needs to differ, but because
// workspace/messages/route.ts's own dispatch chain (see this function's only call site there) uses it as
// a STRUCTURAL bypass that runs regardless of what classifyTaskIntent()/TagWeightedRoutingStrategy
// decided, so a future gap in either of THOSE phrase lists can never again let a spreadsheet-only task
// reach an Anthropic/Gemini/DataForSEO-dependent code path. Deliberately broad on operation verbs (read/
// clean/dedupe/normalize/etc.) -- safe to be broad because this is ONLY ever consulted after the caller
// has already confirmed a real spreadsheet-type attachment is present on THIS message (see route.ts's
// `attachmentMeta && SPREADSHEET_FILE_TYPES.has(...)` guard around its call site).
const SPREADSHEET_OPERATION_PATTERN = /\b(read|inspect\w*|extract\w*|pars\w*|process\w*|analy[zs]\w*|clean\w*|dedup\w*|normali[sz]\w*|duplicate\w*|malformed|incomplete|valid\w*|compare\w*)\b/i;

export function looksLikeSpreadsheetOperationRequest(message: string): boolean {
  return SPREADSHEET_OPERATION_PATTERN.test(message);
}

const MAX_DUPLICATE_GROUPS_SHOWN = 20;
const MAX_FLAGGED_ROWS_SHOWN = 20;

/**
 * Real, local-only read + FULL cleaning pass over one already-attached, ownership-checked file:
 * exact-duplicate removal, domain/URL duplicate flagging, malformed-URL detection, and clearly-
 * incomplete-record detection (see spreadsheet-cleaning.ts's own header for the exact rules). Persists
 * the result as a new pending approval and returns a human-reviewable report -- never writes anywhere.
 */
export async function processSpreadsheetAttachment(userId: string, attachmentMeta: AttachmentMeta): Promise<SpreadsheetProcessingResult> {
  const file = await retrieveAttachmentFile(userId, attachmentMeta.id);
  if (!file) {
    return { ok: false, reply: `I couldn't retrieve the attached file "${attachmentMeta.originalFileName}" to read it. Please re-attach it and try again.` };
  }

  const parsed = readSpreadsheet(file.buffer, attachmentMeta.fileType);
  if (!parsed.ok || !parsed.sheets || !parsed.sheetNames) {
    return { ok: false, reply: `I found the attached file "${attachmentMeta.originalFileName}", but couldn't read its contents: ${parsed.error ?? "unknown error"}` };
  }

  // Cleaning operates on the FIRST worksheet -- the same real-evidence-only discipline as everywhere
  // else in this build: a multi-sheet workbook's other sheets are named in the report, never silently
  // merged together or guessed at.
  const primarySheet = parsed.sheets[0]!;
  const cleaningResult = buildCleaningResult(primarySheet.headers, primarySheet.rows);
  const approval = await createPendingCleaningApproval(userId, attachmentMeta.id, cleaningResult);

  // REVIEWABLE ARTIFACTS (2026-09-02, final business schema 2026-09-03, traffic split 2026-09-03): a
  // real, downloadable cleaned XLSX and a real CSV cleaning audit -- generated once, right after the
  // approval exists, so their on-disk names can be derived from its own id. Neither is the original
  // upload. The cleaned WORKBOOK is reshaped into the fixed, 17-column business schema
  // (mapToFinalBusinessSchema()) and then split into its two real destinations by verified organic
  // traffic (splitByOrganicTraffic()) -- both destinations are prepared as two real, named sheets in the
  // SAME workbook (Admin/Vendor + Client Websites), BEFORE any approval decision exists, so a reviewer
  // can see exactly how the split will look before deciding. The AUDIT stays on the cleaning result's
  // own real source columns (it's about the cleaning PROCESS, not the final business deliverable).
  // Nothing computed twice, nothing invented.
  const businessSchema = mapToFinalBusinessSchema(cleaningResult.headers, cleaningResult.retainedRows, cleaningResult.urlColumnIndex);
  const trafficSplit = splitByOrganicTraffic(businessSchema);
  const cleanedWorkbook = buildXlsxWorkbook([
    { name: ADMIN_VENDOR_SHEET_NAME, headers: trafficSplit.adminVendor.headers, rows: trafficSplit.adminVendor.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
    { name: CLIENT_WEBSITES_SHEET_NAME, headers: trafficSplit.clientWebsites.headers, rows: trafficSplit.clientWebsites.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
  ]);
  const auditCsv = buildCleaningAuditCsv(cleaningResult);
  await saveCleaningArtifacts(approval.id, cleanedWorkbook, auditCsv);

  return {
    ok: true,
    reply: buildCleaningReportForChat(attachmentMeta, parsed, cleaningResult, approval),
    approvalMeta: buildSpreadsheetCleaningApprovalMeta(attachmentMeta.originalFileName, approval),
  };
}

function buildCleaningReportForChat(attachmentMeta: AttachmentMeta, parsed: SpreadsheetReadResult, result: CleaningResult, approval: CleaningApprovalRecord): string {
  const lines: string[] = [];
  lines.push(`I read and cleaned "${attachmentMeta.originalFileName}" locally on this server -- no external service saw this file, and the original upload is unchanged.`);
  lines.push("");
  lines.push(`Worksheet(s) in the file: ${parsed.sheetNames!.join(", ")} (cleaning ran on "${parsed.sheets![0]!.name}").`);

  const exactDuplicateRowTotal = result.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
  const removedCount = result.originalRowCount - result.retainedRowIndexes.length;
  const domainDuplicateRowTotal = result.domainDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);

  lines.push("");
  lines.push("=== A. CLEAN DATASET ===");
  lines.push(`Columns (${result.headers.length}): ${result.headers.join(", ")}`);
  lines.push(`Retained records: ${result.retainedRowIndexes.length} (of ${result.originalRowCount} original data rows -- ${removedCount} exact-duplicate row(s) removed, everything else preserved).`);
  lines.push(`A real, downloadable cleaned workbook and a CSV cleaning audit are attached to this message below -- review both before deciding.`);

  lines.push("");
  lines.push("=== B. DUPLICATE AUDIT ===");
  if (result.exactDuplicateGroups.length === 0) {
    lines.push("Exact duplicates: none found.");
  } else {
    lines.push(`Exact duplicates: ${result.exactDuplicateGroups.length} group(s), ${exactDuplicateRowTotal} row(s) total -- one occurrence kept per group, the rest removed.`);
    for (const group of result.exactDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      const [keepRow, ...removedRows] = group.rowIndexes.map((i) => i + 1);
      lines.push(`  - Kept data row ${keepRow}; removed data row(s) ${removedRows.join(", ")} -- reason: identical values in every column. Values: ${group.values.join(" | ")}`);
    }
    if (result.exactDuplicateGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
      lines.push(`  ...and ${result.exactDuplicateGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more exact-duplicate group(s).`);
    }
  }
  lines.push("");
  if (result.domainDuplicateGroups.length === 0) {
    lines.push("Domain/URL duplicate candidates (same domain, other fields differ -- flagged for review, NOT removed): none found.");
  } else {
    lines.push(
      `Domain/URL duplicate candidates: ${result.domainDuplicateGroups.length} group(s), ${domainDuplicateRowTotal} row(s) total -- flagged for your review, NOT automatically removed:`,
    );
    for (const group of result.domainDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      lines.push(`  - Domain "${group.normalizedDomain}": data row(s) ${group.rowIndexes.map((i) => i + 1).join(", ")} -- reason: same normalized domain, but other column values differ. Proposed action: keep both, review manually.`);
    }
    if (result.domainDuplicateGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
      lines.push(`  ...and ${result.domainDuplicateGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more domain-duplicate group(s).`);
    }
  }

  lines.push("");
  lines.push("=== C. DATA-QUALITY AUDIT ===");
  lines.push(`Malformed URLs: ${result.malformedUrlRows.length}.`);
  for (const flag of result.malformedUrlRows.slice(0, MAX_FLAGGED_ROWS_SHOWN)) {
    lines.push(`  - Data row ${flag.rowIndex + 1}: "${flag.rawValue}" does not parse as a real domain/URL.`);
  }
  if (result.malformedUrlRows.length > MAX_FLAGGED_ROWS_SHOWN) lines.push(`  ...and ${result.malformedUrlRows.length - MAX_FLAGGED_ROWS_SHOWN} more.`);

  lines.push(`Clearly incomplete records: ${result.incompleteRows.length}.`);
  for (const flag of result.incompleteRows.slice(0, MAX_FLAGGED_ROWS_SHOWN)) {
    lines.push(`  - Data row ${flag.rowIndex + 1}: ${flag.reason}`);
  }
  if (result.incompleteRows.length > MAX_FLAGGED_ROWS_SHOWN) lines.push(`  ...and ${result.incompleteRows.length - MAX_FLAGGED_ROWS_SHOWN} more.`);

  lines.push(`Records requiring manual review (union of the above, all still retained): ${result.manualReviewRowIndexes.length}.`);

  lines.push("");
  lines.push("=== D. SUMMARY ===");
  lines.push(`Original data rows: ${result.originalRowCount}`);
  lines.push(`Exact duplicate rows removed: ${exactDuplicateRowTotal} (in ${result.exactDuplicateGroups.length} group(s))`);
  lines.push(`Domain/URL duplicate candidates flagged: ${domainDuplicateRowTotal} (in ${result.domainDuplicateGroups.length} group(s))`);
  lines.push(`Malformed/incomplete rows flagged: ${result.malformedUrlRows.length + result.incompleteRows.length}`);
  lines.push(`Final retained records: ${result.retainedRowIndexes.length}`);
  lines.push(`Rows requiring manual review: ${result.manualReviewRowIndexes.length}`);

  lines.push("");
  lines.push(
    `Nothing has been written to Google Sheets. Use the Approve / Reject buttons above to decide, or reply "approve"/"reject" in chat -- either way requires your explicit action, and your original uploaded file stays untouched regardless. (Approval reference: ${approval.id})`,
  );
  return lines.join("\n");
}

const APPROVAL_REPLY_PATTERN = /\b(approve|approved|approving)\b|\byes[,]?\s*(write|go ahead|proceed)\b|\bgo ahead and write\b|\bwrite it to google sheets\b/i;
const REJECTION_REPLY_PATTERN = /\b(reject|rejected|rejecting|discard|cancel)\b|\bdon'?t write\b|\bdo not write\b/i;

export interface CleaningApprovalReplyResult {
  /** false when this message isn't a recognizable approve/reject reply, or there's no pending approval -- callers should fall through to ordinary routing. */
  readonly handled: boolean;
  readonly reply?: string;
}

/** Checked BEFORE ordinary routing for every message (mirrors the existing in-flight remediation-approval-resume precedent in workspace/messages/route.ts) -- a bare "approve"/"reject" reply rarely scores well against any specialist on its own, so this cannot depend on ordinary intent routing to reach it. Only ever acts when a real pending approval exists AND the message text is a recognizable decision; anything else is left alone (handled: false) so an unrelated message is never silently swallowed as a decision. */
export async function resolveCleaningApprovalReply(userId: string, message: string): Promise<CleaningApprovalReplyResult> {
  const pending = await getMostRecentPendingCleaningApproval(userId);
  if (!pending) return { handled: false };

  const isApproval = APPROVAL_REPLY_PATTERN.test(message);
  const isRejection = REJECTION_REPLY_PATTERN.test(message);
  if (!isApproval && !isRejection) return { handled: false };
  if (isApproval && isRejection) return { handled: false }; // ambiguous -- never guess

  if (isRejection) {
    const result = await rejectCleaningApproval(userId, pending.id);
    return {
      handled: true,
      reply: result.ok
        ? "Understood -- this cleaning result has been discarded. Nothing was written to Google Sheets, and your original uploaded file was never touched."
        : `Could not record the rejection: ${result.error}`,
    };
  }

  const approved = await approveCleaningApproval(userId, pending.id);
  if (!approved.ok || !approved.record) {
    return { handled: true, reply: `Could not record the approval: ${approved.error}` };
  }

  const selected = await getWriteDestinationSpreadsheet(userId);
  if (!selected) {
    return {
      handled: true,
      reply:
        "Approved -- but no Google Sheets WRITE DESTINATION is currently configured, so I have nothing to write to yet. " +
        "Go to Settings -> Integrations, connect Google Sheets if you haven't, and choose a write destination (separate from the read-source picker), then ask me to write the approved result.",
    };
  }

  const writeResult = await writeApprovedCleaningToGoogleSheets(userId, approved.record, selected.id);
  return {
    handled: true,
    reply: writeResult.ok
      ? `Approved and written to "${selected.name}" -- ${writeResult.adminVendorRowCount} record(s) to Admin/Vendor, ${writeResult.clientWebsiteRowCount} record(s) to Client Sheet.`
      : `Approved, but the write to Google Sheets did not complete: ${writeResult.error}`,
  };
}
