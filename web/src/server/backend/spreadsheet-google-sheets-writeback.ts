// SPREADSHEET CLEANING WRITE-BACK GATE (2026-09-02, final business schema 2026-09-03, traffic split
// 2026-09-03, WRITE-RESULT STATE FIX 2026-09-03): the ONLY place in this codebase that writes a cleaned
// dataset to Google Sheets, and the only caller of google-sheets.ts's appendSpreadsheetValues(). Refuses
// to run against anything but a real "approved" or "write_failed" (a genuine retry) SpreadsheetCleaning
// Approval row -- never against a pending, rejected, or already-"written" one -- and never re-derives the
// dataset from the original file (the exact approved snapshot, from the approval row itself, is what gets
// written). What's written is always reshaped into the fixed, 17-column business schema
// (mapToFinalBusinessSchema()) and then split into its two real destinations by verified organic traffic
// (splitByOrganicTraffic()) -- the SAME shapes the reviewable cleaned XLSX artifact's own two sheets
// already use, so what a human reviewed in that download is provably what lands in Google Sheets, tab for
// tab, column for column. Every retained record is written to EXACTLY one of the two tabs -- never both,
// never dropped.
//
// WRITE-RESULT STATE FIX (2026-09-03): a real, live-confirmed defect -- the DB status was correctly never
// falsely set to "written" on a failed write, but there was no PERSISTED signal that a write had even been
// attempted and failed -- the approval row (and therefore every UI surface reading it) stayed at
// "approved" forever, indistinguishable from "approved, write never attempted yet". The Workspace card
// showed a plain green "Approved" badge with the Approve button gone and no way to retry, while the real
// destination spreadsheet stayed empty. Fixed by persisting a genuinely separate "write_failed" status
// (markCleaningApprovalWriteFailed()) on any real failure, and by making "approved" OR "write_failed" both
// valid starting points for this function -- so a retry from either state is a normal, supported path
// through the SAME function, never a second write system.
//
// RETRY SAFETY / PER-TAB IDEMPOTENCY (2026-09-03): spreadsheets.values.append is NOT idempotent -- it
// always appends new rows, so if Admin/Vendor's append succeeds but Client Websites' then throws, a naive
// retry would re-send Admin/Vendor's rows a second time, duplicating them. Each tab's real success is
// recorded immediately (markSpreadsheetTabWritten(), never batched until the end) on the approval row
// itself (adminVendorWrittenAt/clientWebsitesWrittenAt); a retry skips any tab already marked written by a
// PRIOR attempt, so only the genuinely-still-needed tab(s) are ever (re-)sent.
//
// See google-sheets.ts's own header for the real, honest scope-detection behavior: a connection authorized
// before the write scope was added will fail here with a clear InsufficientGoogleSheetsScopeError-derived
// message asking the user to reconnect -- this module does not paper over that or assume success; it
// surfaces the real error via the catch below and persists it as "write_failed", never a silent no-op.
//
// A1-NOTATION RANGE FIX (2026-09-03): a real, live-confirmed defect -- a real production write to
// "Admin - Vendor" was rejected by Google with a real 400 ("Unable to parse range: Admin - Vendor!A1"),
// because the range was built as a bare, unquoted `${ADMIN_VENDOR_SHEET_NAME}!A1` -- A1 notation requires
// a sheet name containing a space, hyphen, or other special character to be single-quoted (Google Sheets'
// own grammar). Fixed via buildTabRange() below, which (a) quotes the sheet name through the reusable,
// general google-sheets.ts helper quoteSheetName() (never a special case for just these two names -- any
// future tab name with spaces/hyphens/apostrophes is safe too), and (b) computes the actual column extent
// (A:Q for the real 17-column schema) and end row from the REAL payload dimensions being sent, never a
// hard-coded row count.
//
// TAB-EXISTENCE FIX (2026-09-03): a real, live-confirmed follow-on defect -- even with the range correctly
// quoted and dimensioned ('Admin - Vendor'!A1:Q1216), the real write STILL failed with the same "Unable to
// parse range" 400, because that exact error is ALSO what Google returns when the referenced sheet/tab
// does not yet exist in the target spreadsheet -- values.append never creates a missing sheet. This code
// had no tab-resolution step at all (Option A from the diagnosis: it assumed "Admin - Vendor"/"Client
// Websites" already existed in whatever spreadsheet the user configured, which is untrue for a real,
// pre-existing spreadsheet like "SaaS Website Master Database" that was never specifically set up with
// these tab names). Fixed by calling google-sheets.ts's ensureSheetExists() immediately before each tab's
// real append -- a real, ownership-scoped read-then-create-if-missing step, never assumed, and a genuine
// no-op (one cheap read call, no write) once the tab exists (including on every later retry).

import { appendSpreadsheetValues, assertSheetsWriteScope, ensureSheetExists, quoteSheetName } from "@/server/google-sheets";
import { columnIndexToLetter } from "./xlsx-writer";
import { markCleaningApprovalWritten, markCleaningApprovalWriteFailed, markSpreadsheetTabWritten, type CleaningApprovalRecord } from "./spreadsheet-cleaning-approval";
import { mapToFinalBusinessSchema, splitByOrganicTraffic, ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME } from "./spreadsheet-business-schema";
import { readWriteDestinationForDuplicateProtection } from "./google-sheets-cleaning";
import { applyDestinationProtection } from "./spreadsheet-destination-protection";

export interface WriteBackResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly adminVendorRowCount?: number;
  readonly clientWebsiteRowCount?: number;
  /** How many incoming records were held back because they duplicate an existing PRICED destination record -- never written, and the existing destination record was never touched. */
  readonly protectedOmittedCount?: number;
  /** How many incoming records were held back (also never written) because BOTH the existing destination record and the incoming record are priced -- flagged for manual review, not auto-resolved either way. */
  readonly flaggedForManualReviewCount?: number;
}

const WRITE_ELIGIBLE_STATUSES: readonly CleaningApprovalRecord["status"][] = ["approved", "write_failed"];

/** Builds a real, validly-quoted A1 range from the sheet name and the ACTUAL dimensions of the values being sent (`values` includes the header row) -- e.g. `'Admin - Vendor'!A1:Q43` for a 17-column, 42-data-row payload. Never a hard-coded row/column count. */
function buildTabRange(sheetName: string, values: readonly (readonly string[])[]): string {
  const columnCount = values[0]?.length ?? 0;
  const lastColumnLetter = columnIndexToLetter(Math.max(columnCount - 1, 0));
  return `${quoteSheetName(sheetName)}!A1:${lastColumnLetter}${values.length}`;
}

/**
 * Writes an "approved" (or retries a "write_failed") record's retained rows, reshaped into the fixed
 * 17-column business schema and split by verified organic traffic into two real tabs within
 * `spreadsheetId` (ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME) -- refuses for any other status
 * (pending/rejected/already-written), never partially writes for an ineligible record. A destination with
 * zero rows is skipped (no pointless empty write). A tab already marked written by a PRIOR attempt on this
 * same approval is also skipped (idempotent retry -- never re-appends the same rows twice). If any real
 * write still fails, the approval is persisted as "write_failed" (never left ambiguously at "approved",
 * and never falsely "written") so the user can see the failure and safely retry once the cause is fixed.
 */
export async function writeApprovedCleaningToGoogleSheets(userId: string, approval: CleaningApprovalRecord, spreadsheetId: string): Promise<WriteBackResult> {
  if (!WRITE_ELIGIBLE_STATUSES.includes(approval.status)) {
    return { ok: false, error: `Refusing to write -- this cleaning result's status is "${approval.status}". Nothing was sent to Google Sheets.` };
  }

  const businessSchema = mapToFinalBusinessSchema(approval.result.headers, approval.result.retainedRows, approval.result.urlColumnIndex);

  // DESTINATION PROTECTION (2026-09-18): a real, live-confirmed defect -- the actual write here used to
  // re-derive businessSchema/split fresh from the approved snapshot with no awareness of the destination's
  // OWN existing content, so an incoming record that duplicated an already-priced destination record could
  // still be appended even after a proposal claimed it would be protected. Read-only (never writes) -- see
  // readWriteDestinationForDuplicateProtection()'s and applyDestinationProtection()'s own headers. The
  // destination read here targets the SAME spreadsheetId this function is about to write to (the caller
  // already resolved it from the user's own configured write destination), so this is always the real,
  // current destination content, never a stale/different one.
  const destinationOutcome = await readWriteDestinationForDuplicateProtection(userId);
  const protection = destinationOutcome.status === "ok" ? applyDestinationProtection(businessSchema, destinationOutcome) : null;
  const eligibleSchema = protection?.applied ? { headers: businessSchema.headers, rows: protection.eligibleRows, mappedColumns: businessSchema.mappedColumns } : businessSchema;

  const split = splitByOrganicTraffic(eligibleSchema);

  try {
    // Checked ONCE, up front, before any real network call at all -- otherwise a connection with a
    // known-insufficient scope would still make a real (if ultimately pointless) spreadsheets.get read
    // via ensureSheetExists() below before ever reaching appendSpreadsheetValues()'s own check.
    await assertSheetsWriteScope(userId);

    if (split.adminVendor.rows.length > 0 && !approval.adminVendorWrittenAt) {
      const adminValues: string[][] = [split.adminVendor.headers.slice(), ...split.adminVendor.rows.map((row) => row.slice())];
      await ensureSheetExists(userId, spreadsheetId, ADMIN_VENDOR_SHEET_NAME);
      await appendSpreadsheetValues(userId, spreadsheetId, buildTabRange(ADMIN_VENDOR_SHEET_NAME, adminValues), adminValues);
      await markSpreadsheetTabWritten(userId, approval.id, "adminVendor");
    }
    if (split.clientWebsites.rows.length > 0 && !approval.clientWebsitesWrittenAt) {
      const clientValues: string[][] = [split.clientWebsites.headers.slice(), ...split.clientWebsites.rows.map((row) => row.slice())];
      await ensureSheetExists(userId, spreadsheetId, CLIENT_WEBSITES_SHEET_NAME);
      await appendSpreadsheetValues(userId, spreadsheetId, buildTabRange(CLIENT_WEBSITES_SHEET_NAME, clientValues), clientValues);
      await markSpreadsheetTabWritten(userId, approval.id, "clientWebsites");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    await markCleaningApprovalWriteFailed(userId, approval.id);
    return { ok: false, error: `The write to Google Sheets failed: ${reason}` };
  }

  const marked = await markCleaningApprovalWritten(userId, approval.id);
  if (!marked.ok) {
    return { ok: false, error: `The write to Google Sheets succeeded, but recording it failed: ${marked.error}` };
  }
  return {
    ok: true,
    adminVendorRowCount: split.adminVendor.rows.length,
    clientWebsiteRowCount: split.clientWebsites.rows.length,
    protectedOmittedCount: protection?.protectedOmittedRows.length ?? 0,
    flaggedForManualReviewCount: protection?.flaggedForManualReviewRows.length ?? 0,
  };
}
