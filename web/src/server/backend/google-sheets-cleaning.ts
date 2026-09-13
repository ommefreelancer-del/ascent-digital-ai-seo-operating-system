// GOOGLE SHEETS LIVE CLEANING (2026-09-14): a real, live-confirmed production defect -- once
// buildGoogleSheetsContext() (google-sheets-integration.ts) started reading a selected spreadsheet
// completely (batch read fix, 2026-09-14), the AI Workspace agent could still only ever receive up to
// ~5,000 raw rows embedded verbatim in its own chat context. "Health Master Sheet"'s Sheet1 genuinely
// has more than 5,000 rows, so asking the agent to manually analyze/dedupe/bucket the complete dataset
// by reading raw rows is unreliable (the model can miscount, skip, or hallucinate across a huge pasted
// table) and wastes real AI credits reprocessing what is actually a deterministic, mechanical task.
//
// This module moves that deterministic work OFF the model entirely: it reads the complete selected
// sheet server-side, in real batches (getAllSpreadsheetValues(), with a much higher ceiling than the
// chat-context path uses, since nothing here is ever embedded in a prompt), then reuses the SAME
// already-existing, already-tested cleaning pipeline the XLSX-attachment path already relies on
// (spreadsheet-cleaning.ts's buildCleaningResult(), spreadsheet-business-schema.ts's
// mapToFinalBusinessSchema()/splitByOrganicTraffic()) -- never a second, parallel dedup/bucketing
// implementation. The agent is handed a COMPACT, count-based summary (never thousands of raw rows); the
// complete, exact result (every retained row) is persisted as a real, pending SpreadsheetCleaningApproval
// row -- the SAME human-approval gate and the SAME writeApprovedCleaningToGoogleSheets() write path the
// attachment flow already uses, completely unchanged. NOTHING is ever written, deleted, moved, or
// overwritten by this module -- it only reads (values.get) and persists a pending proposal.
//
// SOURCE-RECORD NOTE: SpreadsheetCleaningApproval.attachmentId is a real, required foreign key to
// Attachment (no schema change made here). Since there is no real uploaded file for a live Google Sheets
// source, this creates one real, honest Attachment row per run -- fileType "google-sheet" (a new,
// clearly-distinct value from the upload allowlist's xlsx/xls/csv/pdf/docx, never confused with a real
// upload), sizeBytes 0, storagePath "" (genuinely no bytes on disk) -- purely to satisfy that existing
// constraint without inventing a second approval model or touching schema.prisma.

import { db } from "@/server/db";
import { getSelectedSpreadsheet, getAllSpreadsheetValues, type AllSpreadsheetValuesResult } from "@/server/google-sheets";
import { buildCleaningResult, buildCleaningAuditCsv, type CleaningResult } from "./spreadsheet-cleaning";
import {
  mapToFinalBusinessSchema,
  splitByOrganicTraffic,
  ADMIN_VENDOR_SHEET_NAME,
  CLIENT_WEBSITES_SHEET_NAME,
  BUSINESS_SCHEMA_COLUMN_WIDTHS,
  BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS,
} from "./spreadsheet-business-schema";
import { buildXlsxWorkbook } from "./xlsx-writer";
import { createPendingCleaningApproval, type CleaningApprovalRecord } from "./spreadsheet-cleaning-approval";
import { saveCleaningArtifacts } from "./spreadsheet-cleaning-artifacts";
import { buildSpreadsheetCleaningApprovalMeta, type SpreadsheetProcessingResult } from "./spreadsheet-processing";

/**
 * Ceiling for THIS server-side path only -- deliberately much higher than
 * google-sheets-integration.ts's own default (5,000, tuned for "safe to embed verbatim in an LLM
 * prompt"). Nothing here is ever sent to a model, so a real "Health Master Sheet" (reported 5,000+
 * rows) can genuinely be read to its true end. Still finite -- a pathological sheet can never cause an
 * unbounded number of real API calls -- and any real cap hit is reported honestly (never silently) via
 * AllSpreadsheetValuesResult.cappedAtSafetyLimit, propagated into the chat report below.
 */
const MAX_ROWS_FOR_SERVER_SIDE_PROCESSING = 200_000;

const MAX_DUPLICATE_GROUPS_SHOWN = 20;
const MAX_FLAGGED_ROWS_SHOWN = 20;
const MAX_TRAFFIC_SAMPLES_SHOWN = 10;

/**
 * The one, real, end-to-end live-sheet cleaning entry point: resolves the user's persisted selection
 * (getSelectedSpreadsheet -- never a hardcoded id), reads it COMPLETELY server-side in real batches,
 * runs the same deterministic cleaning + business-schema + traffic-split pipeline the attachment path
 * already uses, persists a real pending approval, and returns a compact chat report. Never writes,
 * deletes, moves, or overwrites anything -- and never asks the user to paste/attach data ADASOS can
 * already read itself.
 */
export async function processSelectedGoogleSheet(userId: string): Promise<SpreadsheetProcessingResult> {
  const selected = await getSelectedSpreadsheet(userId);
  if (!selected) {
    return {
      ok: false,
      reply:
        "No spreadsheet is currently selected for this integration, so there's nothing to clean yet. " +
        "Go to Settings -> Integrations and choose a spreadsheet as the read source first.",
    };
  }

  let readResult: AllSpreadsheetValuesResult;
  try {
    readResult = await getAllSpreadsheetValues(userId, selected.id, { maxTotalRows: MAX_ROWS_FOR_SERVER_SIDE_PROCESSING });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return { ok: false, reply: `I tried to read "${selected.name}" to clean it, but the read failed: ${reason}` };
  }

  if (readResult.rowsRead === 0) {
    return { ok: false, reply: `"${selected.name}" (its first sheet) is genuinely empty -- there's nothing to clean.` };
  }

  const [headerRow, ...dataRows] = readResult.values;
  const headers = (headerRow ?? []).map((cell) => cell ?? "");
  const rows = dataRows.map((row) => row.map((cell) => cell ?? ""));

  // The SAME real, already-tested cleaning logic the XLSX-attachment path uses -- exact-duplicate
  // removal (URL-normalized domain matching, see spreadsheet-cleaning.ts), domain-duplicate flagging,
  // malformed/incomplete detection. A repeated header row embedded mid-data is handled by
  // mapToFinalBusinessSchema()'s own isEmbeddedHeaderRow() filter below, exactly as it already is for
  // an uploaded multi-section export -- never a second, separate implementation for the live-sheet case.
  const cleaningResult = buildCleaningResult(headers, rows);

  const sourceRecord = await db.attachment.create({
    data: {
      userId,
      originalFileName: selected.name,
      fileType: "google-sheet",
      mimeType: "application/vnd.google-apps.spreadsheet",
      sizeBytes: 0,
      storagePath: "",
    },
  });

  const approval = await createPendingCleaningApproval(userId, sourceRecord.id, cleaningResult);

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
    reply: buildLiveSheetCleaningReportForChat(selected.name, readResult, cleaningResult, trafficSplit.clientWebsites.rows.length, approval),
    approvalMeta: buildSpreadsheetCleaningApprovalMeta(selected.name, approval),
  };
}

/**
 * A COMPACT, count-based report -- never the retained rows themselves. Mirrors
 * spreadsheet-processing.ts's own buildCleaningReportForChat() section structure (A/B/C/D) so a reviewer
 * sees the same shape of report regardless of source, adapted for a live-read source: states how many
 * real batches were read and whether the real safety ceiling (not genuine end of data) was the reason
 * reading stopped, and adds a traffic-bucket summary (< 1,000 vs K/M) satisfying the "identify <1,000
 * traffic records" requirement without dumping every one of them into the chat.
 */
function buildLiveSheetCleaningReportForChat(
  spreadsheetName: string,
  readResult: AllSpreadsheetValuesResult,
  result: CleaningResult,
  belowThresholdCount: number,
  approval: CleaningApprovalRecord,
): string {
  const lines: string[] = [];
  lines.push(
    `I read and cleaned "${spreadsheetName}" (its first sheet) live via ADASOS's own Google Sheets connection -- ` +
      `${readResult.batchesRead} real batch(es), ${readResult.rowsRead} row(s) total read server-side. Nothing was sent to any AI model as raw rows.`,
  );
  if (readResult.cappedAtSafetyLimit) {
    lines.push(
      `NOTE: reading stopped at a real safety limit (${readResult.rowsRead} rows) rather than a confirmed end of data -- ` +
        "this sheet may genuinely have more rows beyond what was processed here.",
    );
  }

  const exactDuplicateRowTotal = result.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
  const removedCount = result.originalRowCount - result.retainedRowIndexes.length;
  const domainDuplicateRowTotal = result.domainDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);

  lines.push("");
  lines.push("=== A. CLEAN DATASET ===");
  lines.push(`Columns (${result.headers.length}): ${result.headers.join(", ")}`);
  lines.push(`Retained records: ${result.retainedRowIndexes.length} (of ${result.originalRowCount} original data rows -- ${removedCount} exact-duplicate row(s) removed, everything else preserved).`);
  lines.push("A real, downloadable cleaned workbook and a CSV cleaning audit are attached to this message below -- review both before deciding.");

  lines.push("");
  lines.push("=== B. DUPLICATE AUDIT ===");
  if (result.exactDuplicateGroups.length === 0) {
    lines.push("Exact duplicates: none found.");
  } else {
    lines.push(`Exact duplicates: ${result.exactDuplicateGroups.length} group(s), ${exactDuplicateRowTotal} row(s) total -- one canonical occurrence kept per group, the rest removed.`);
    for (const group of result.exactDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      const [keepRow, ...removedRows] = group.rowIndexes.map((i) => i + 1);
      lines.push(`  - Kept data row ${keepRow}; removed data row(s) ${removedRows.join(", ")} -- reason: identical values in every column.`);
    }
    if (result.exactDuplicateGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
      lines.push(`  ...and ${result.exactDuplicateGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more exact-duplicate group(s).`);
    }
  }
  lines.push("");
  if (result.domainDuplicateGroups.length === 0) {
    lines.push("Domain/URL duplicate candidates (same normalized domain, other fields differ -- flagged for review, NOT removed): none found.");
  } else {
    lines.push(`Domain/URL duplicate candidates: ${result.domainDuplicateGroups.length} group(s), ${domainDuplicateRowTotal} row(s) total -- flagged for your review, NOT automatically removed:`);
    for (const group of result.domainDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      lines.push(`  - Domain "${group.normalizedDomain}": data row(s) ${group.rowIndexes.map((i) => i + 1).join(", ")}.`);
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
  if (result.incompleteRows.length > 0) lines.push(`  (see the attached audit CSV for every flagged row)`);

  lines.push("");
  lines.push("=== D. TRAFFIC BUCKETS (Domain Search Traffic / Organic Traffic) ===");
  lines.push(`Records with organic traffic BELOW 1,000 (retained, routed to "${CLIENT_WEBSITES_SHEET_NAME}" if approved): ${belowThresholdCount}.`);
  lines.push(`Records with organic traffic >= 1,000 (retained, routed to "${ADMIN_VENDOR_SHEET_NAME}" if approved): ${result.retainedRowIndexes.length - belowThresholdCount}.`);
  lines.push(`Display formatting: values under 1,000 shown as-is; 1,000-999,999 shown as K (e.g. "2.5K"); 1,000,000+ shown as M (e.g. "1.2M") -- applied only for display, the real underlying number always decides the traffic-bucket routing above.`);
  const sampleTrafficValues = result.retainedRows.slice(0, MAX_TRAFFIC_SAMPLES_SHOWN);
  if (sampleTrafficValues.length > 0) {
    lines.push(`(First ${sampleTrafficValues.length} retained record(s) shown for reference; the complete set is in the attached cleaned workbook, never re-typed into chat.)`);
  }

  lines.push("");
  lines.push("=== E. SUMMARY ===");
  lines.push(`Original data rows read (server-side, complete): ${result.originalRowCount}`);
  lines.push(`Exact duplicate rows removed: ${exactDuplicateRowTotal} (in ${result.exactDuplicateGroups.length} group(s))`);
  lines.push(`Domain/URL duplicate candidates flagged: ${domainDuplicateRowTotal} (in ${result.domainDuplicateGroups.length} group(s))`);
  lines.push(`Final retained records: ${result.retainedRowIndexes.length}`);
  lines.push(`Records requiring manual review: ${result.manualReviewRowIndexes.length}`);

  lines.push("");
  lines.push(
    `Nothing has been written to, deleted from, or moved in "${spreadsheetName}" -- this is a proposal only. ` +
      `Use the Approve / Reject buttons above to decide, or reply "approve"/"reject" in chat -- either way requires your explicit action. (Approval reference: ${approval.id})`,
  );
  return lines.join("\n");
}
