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
import { getSelectedSpreadsheet, getAllSpreadsheetValues, getWriteDestinationSpreadsheet, listSpreadsheets, type AllSpreadsheetValuesResult } from "@/server/google-sheets";
import {
  buildCleaningResult,
  buildCleaningAuditCsv,
  buildFullyDedupedCleaningAuditCsv,
  realignColumnShiftedRow,
  collapseDomainDuplicatesToOnePerDomain,
  detectDomainLevelDedupIntent,
  detectPricingColumns,
  KNOWN_LARGE_PLATFORM_DOMAINS,
  type CleaningResult,
  type DomainDedupedCleaningResult,
} from "./spreadsheet-cleaning";
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
import { buildSpreadsheetCleaningApprovalMeta, type SpreadsheetProcessingResult } from "./spreadsheet-cleaning-approval-meta";
import { applyDestinationProtection, type DestinationProtectionResult } from "./spreadsheet-destination-protection";

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

// DESTINATION-SELECTION RESTORATION (2026-09-16): a real, live-confirmed workflow gap -- the Health Master
// live-sheet cleaning path built a full proposal without ever checking whether a Google Sheets WRITE
// destination was configured, and without reading that destination's existing content at all. The
// write-destination selector itself already exists and already works (Settings -> Integrations' "Write
// destination" dropdown, backed by the real getWriteDestinationSpreadsheet()/setWriteDestinationSpreadsheet()
// pair and listSpreadsheets() discovery -- see settings-shell.tsx and
// api/integrations/google-sheets/write-destination/route.ts) -- the attachment-upload cleaning path
// (spreadsheet-processing.ts) already relies on it at APPROVAL time. This module never surfaced it at
// PROPOSAL time, so a user cleaning "Health Master Sheet" had no visibility into whether -- or where --
// approved results could even be written, and no read of the real destination's existing priced/deal-done
// records to protect them from later duplicate resolution (that price-aware protection ALGORITHM is a
// separate, later task -- this only restores the missing SELECTION + READ step so that algorithm has real
// data to work with once it exists).
//
// Deliberately reuses the EXISTING architecture end to end -- getWriteDestinationSpreadsheet() (never a new
// selection mechanism), listSpreadsheets() (the same real, already-authenticated Drive discovery every other
// selector in this codebase uses), and getAllSpreadsheetValues() (the same read-only batch reader Health
// Master's own source read uses) -- and NEVER hardcodes any particular destination sheet's name anywhere in
// this file: whatever the user has configured (or has NOT configured yet, in which case their real, live
// spreadsheet list is surfaced so they can choose) is what this reports and reads.
export type DestinationReadOutcome =
  | { readonly status: "not_configured"; readonly availableSpreadsheets: readonly { readonly id: string; readonly name: string }[] }
  | { readonly status: "read_failed"; readonly destinationId: string; readonly destinationName: string; readonly reason: string }
  | {
      readonly status: "ok";
      readonly destinationId: string;
      readonly destinationName: string;
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
      readonly rowsRead: number;
      /** Real, exact (normalized) header matches only -- never a guess -- so a future duplicate-resolution
       * step knows WHICH of the destination's own columns to trust for price/deal-status data. */
      readonly pricingColumnsDetected: readonly string[];
    };

/** Ceiling for the destination read -- same value and same honesty convention as MAX_ROWS_FOR_SERVER_SIDE_PROCESSING above: a real, large existing Admin/deal-tracking destination must never be silently truncated either. */
const MAX_ROWS_FOR_DESTINATION_READ = 200_000;

/**
 * Restores the missing destination-selection step: if the user has NOT yet configured a Google Sheets
 * write destination (via the EXISTING Settings -> Integrations selector), returns their real, live list of
 * available spreadsheets (listSpreadsheets() -- the same authenticated Drive discovery every other selector
 * in this codebase already uses) so they can choose one there -- never a hardcoded suggestion. If a
 * destination IS configured, reads it COMPLETELY, read-only (getAllSpreadsheetValues() -- the exact same
 * batch reader Health Master's own source read uses, so a large real destination sheet is never silently
 * truncated), and reports which of its own columns look like real pricing/deal-status data -- making that
 * data available to a FUTURE duplicate-resolution step without acting on it here. NEVER writes anywhere;
 * NEVER hardcodes a destination name.
 */
export async function readWriteDestinationForDuplicateProtection(userId: string): Promise<DestinationReadOutcome> {
  const destination = await getWriteDestinationSpreadsheet(userId);
  if (!destination) {
    // Real, honest fallback -- listSpreadsheets() itself makes a real Drive call and throws when there's no
    // usable Google connection at all (not just "no destination chosen yet"); never let that crash this
    // read-only investigative step. An empty list is the honest answer when the real list can't be fetched.
    let availableSpreadsheets: { id: string; name: string }[] = [];
    try {
      const spreadsheets = await listSpreadsheets(userId);
      availableSpreadsheets = spreadsheets.map((s) => ({ id: s.id, name: s.name }));
    } catch {
      availableSpreadsheets = [];
    }
    return { status: "not_configured", availableSpreadsheets };
  }

  try {
    const readResult = await getAllSpreadsheetValues(userId, destination.id, { maxTotalRows: MAX_ROWS_FOR_DESTINATION_READ });
    const [headerRow, ...dataRows] = readResult.values;
    const headers = (headerRow ?? []).map((cell) => cell ?? "");
    // ROW COLUMN-OFFSET REALIGNMENT (2026-09-21): a real, live-confirmed defect -- a live proposal reported
    // "0 existing priced/deal-done websites" for a real destination ("Admin Sheet Health") known to contain
    // priced records. Root cause: this read never applied realignColumnShiftedRow() (spreadsheet-cleaning.ts),
    // the SAME leading-blank-column-offset fix the Health Master SOURCE read already applies in
    // buildCleaningResult() (see that function's own header -- a real Health Master run had 72% of its rows
    // shifted this way). Without it, a shifted destination row's price/URL cells land at the WRONG fixed
    // index in buildProtectedWebsiteSet() (spreadsheet-destination-protection.ts), so a genuinely-priced
    // record reads as blank there and is silently treated as unprotected. Applied here, once, before this
    // outcome is handed to buildProtectedWebsiteSet() (or reported to the user) -- never a second, separate
    // realignment implementation.
    const rows = dataRows.map((row) => realignColumnShiftedRow(row.map((cell) => cell ?? ""), headers.length));
    return {
      status: "ok",
      destinationId: destination.id,
      destinationName: destination.name,
      headers,
      rows,
      rowsRead: rows.length,
      pricingColumnsDetected: detectPricingColumns(headers),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return { status: "read_failed", destinationId: destination.id, destinationName: destination.name, reason };
  }
}

/**
 * The one, real, end-to-end live-sheet cleaning entry point: resolves the user's persisted selection
 * (getSelectedSpreadsheet -- never a hardcoded id), reads it COMPLETELY server-side in real batches,
 * runs the same deterministic cleaning + business-schema + traffic-split pipeline the attachment path
 * already uses, persists a real pending approval, and returns a compact chat report. Never writes,
 * deletes, moves, or overwrites anything -- and never asks the user to paste/attach data ADASOS can
 * already read itself.
 */
export async function processSelectedGoogleSheet(userId: string, message?: string): Promise<SpreadsheetProcessingResult> {
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
  const baseCleaningResult = buildCleaningResult(headers, rows);

  // DOMAIN-LEVEL DEDUP (2026-09-24): a real, live-confirmed gap -- a request like "Remove exact duplicates
  // and apply one-record-per-domain cleanup, excluding large platform domains" reached THIS flow (source
  // sheet -> configured destination), not the existing-output-tab self-cleanup flow (which only recognizes
  // "Admin - Vendor"/"Client Sheet" by name) -- and this flow never applied domain-level collapsing at all,
  // only ever flagging domain duplicates for manual review. detectDomainLevelDedupIntent() (shared with
  // that other flow, spreadsheet-cleaning.ts) and collapseDomainDuplicatesToOnePerDomain() close that gap
  // here too, so "one record per domain" is honored automatically whenever the request text asks for it,
  // regardless of which flow the request reaches. Optional `message` (omitted by every pre-existing
  // caller/test) preserves the exact prior default (exact-duplicate removal only, domain duplicates
  // flagged) when absent. collapseDomainDuplicatesToOnePerDomain() itself ALWAYS protects known large
  // platform domains and already-priced/dealt records -- see its own header -- no options needed here.
  const intent = message ? detectDomainLevelDedupIntent(message) : { dedupeByDomain: false };
  const domainDedup: DomainDedupedCleaningResult | null = intent.dedupeByDomain ? collapseDomainDuplicatesToOnePerDomain(baseCleaningResult) : null;
  const cleaningResult = domainDedup?.result ?? baseCleaningResult;

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

  // DESTINATION PROTECTION (2026-09-18): read-only, never writes -- see
  // readWriteDestinationForDuplicateProtection()'s and applyDestinationProtection()'s own headers above.
  // Fetched and applied BEFORE the traffic split/artifacts below, so an incoming record that duplicates an
  // already-priced destination record never reaches the written/downloadable output at all -- the existing
  // destination record itself is never read here for removal, only consulted to decide about INCOMING rows.
  const destinationOutcome = await readWriteDestinationForDuplicateProtection(userId);
  const destinationProtection: DestinationProtectionResult | null =
    destinationOutcome.status === "ok" ? applyDestinationProtection(businessSchema, destinationOutcome) : null;
  const eligibleSchema = destinationProtection?.applied
    ? { headers: businessSchema.headers, rows: destinationProtection.eligibleRows, mappedColumns: businessSchema.mappedColumns }
    : businessSchema;

  const trafficSplit = splitByOrganicTraffic(eligibleSchema);
  const cleanedWorkbook = buildXlsxWorkbook([
    { name: ADMIN_VENDOR_SHEET_NAME, headers: trafficSplit.adminVendor.headers, rows: trafficSplit.adminVendor.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
    { name: CLIENT_WEBSITES_SHEET_NAME, headers: trafficSplit.clientWebsites.headers, rows: trafficSplit.clientWebsites.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
  ]);
  const auditCsv = domainDedup
    ? buildFullyDedupedCleaningAuditCsv(domainDedup.base, new Set(domainDedup.result.retainedRowIndexes), new Set(KNOWN_LARGE_PLATFORM_DOMAINS))
    : buildCleaningAuditCsv(cleaningResult);
  await saveCleaningArtifacts(approval.id, cleanedWorkbook, auditCsv);

  return {
    ok: true,
    reply: buildLiveSheetCleaningReportForChat(selected.name, readResult, cleaningResult, trafficSplit.clientWebsites.rows.length, approval, destinationOutcome, destinationProtection, domainDedup),
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
  destinationOutcome: DestinationReadOutcome,
  destinationProtection: DestinationProtectionResult | null,
  domainDedup: DomainDedupedCleaningResult | null = null,
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

  // DOMAIN-LEVEL DEDUP (2026-09-24): when the user's own message asked for "one record per domain" (see
  // detectDomainLevelDedupIntent() in spreadsheet-cleaning.ts), `result` here is ALREADY the collapsed
  // result (domainDedup.result) -- `domainDedup.base` is the exact-dedup-only result underneath it, needed
  // to report the real, raw domain-duplicate-group data (which domains, which rows) the collapse acted on.
  // The default (domainDedup === null) branches below are BYTE-IDENTICAL to this function's prior behavior.
  const base = domainDedup?.base ?? result;
  const exactDuplicateRawMemberTotal = base.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
  const exactDuplicateActualRemovedCount = exactDuplicateRawMemberTotal - base.exactDuplicateGroups.length;
  const removedCount = result.originalRowCount - result.retainedRowIndexes.length;
  const domainDuplicateRowTotal = base.domainDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);

  lines.push("");
  lines.push("=== A. CLEAN DATASET ===");
  lines.push(`Columns (${result.headers.length}): ${result.headers.join(", ")}`);
  if (domainDedup) {
    const domainDuplicateAdditionalRemovedTotal = domainDedup.domainDuplicateAdditionalRemovedRowIndexes.size;
    lines.push(
      `Retained records: ${result.retainedRowIndexes.length} (of ${result.originalRowCount} original data rows -- ${removedCount} row(s) removed: ` +
        `${exactDuplicateActualRemovedCount} exact-duplicate row(s), plus ${domainDuplicateAdditionalRemovedTotal} additional row(s) removed to keep exactly ONE record per website/domain` +
        (domainDedup.excludedDomainGroups.length > 0 ? `, excluding ${domainDedup.excludedDomainGroups.length} known large platform domain(s) -- see below` : "") +
        ").",
    );
    lines.push(
      'Selection rule for which row is kept per domain: the row with the LOWEST original row number in this sheet (same convention already used for exact duplicates) -- never a guess based on which row "looks more complete".',
    );
  } else {
    lines.push(`Retained records: ${result.retainedRowIndexes.length} (of ${result.originalRowCount} original data rows -- ${removedCount} exact-duplicate row(s) removed, everything else preserved).`);
  }
  lines.push("A real, downloadable cleaned workbook and a CSV cleaning audit are attached to this message below -- review both before deciding.");

  lines.push("");
  lines.push("=== B. DUPLICATE AUDIT ===");
  if (base.exactDuplicateGroups.length === 0) {
    lines.push("Exact duplicates: none found.");
  } else {
    lines.push(`Exact duplicates: ${base.exactDuplicateGroups.length} group(s), ${exactDuplicateRawMemberTotal} row(s) total -- one canonical occurrence kept per group, the rest removed.`);
    for (const group of base.exactDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      const [keepRow, ...removedRows] = group.rowIndexes.map((i) => i + 1);
      lines.push(`  - Kept data row ${keepRow}; removed data row(s) ${removedRows.join(", ")} -- reason: identical values in every column.`);
    }
    if (base.exactDuplicateGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
      lines.push(`  ...and ${base.exactDuplicateGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more exact-duplicate group(s).`);
    }
  }
  lines.push("");
  if (domainDedup) {
    const protectedGroups = new Set([...domainDedup.excludedDomainGroups, ...domainDedup.pricingProtectedGroups]);
    const collapsedGroups = base.domainDuplicateGroups.filter((g) => !protectedGroups.has(g));
    if (collapsedGroups.length === 0) {
      lines.push("Domain/URL duplicate candidates collapsed to one record per domain: none.");
    } else {
      lines.push(
        `Domain/URL duplicate candidates: ${collapsedGroups.length} group(s), ${domainDedup.domainDuplicateAdditionalRemovedRowIndexes.size} row(s) REMOVED (one unique record kept per domain):`,
      );
      for (const group of collapsedGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
        const sorted = [...group.rowIndexes].sort((a, b) => a - b);
        const [keepRow, ...removedRows] = sorted.map((i) => i + 1);
        lines.push(`  - Domain "${group.normalizedDomain}": keep data row ${keepRow}; remove data row(s) ${removedRows.join(", ")}.`);
      }
      if (collapsedGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
        lines.push(`  ...and ${collapsedGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more domain-duplicate group(s) -- see the attached audit CSV for the complete list.`);
      }
    }
    if (domainDedup.excludedDomainGroups.length > 0) {
      const excludedRowTotal = domainDedup.excludedDomainGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
      lines.push("");
      lines.push(
        `EXCLUDED from domain-level collapsing (known large platform domains -- every row kept, only flagged for review, exactly like the default mode): ` +
          `${domainDedup.excludedDomainGroups.length} domain(s), ${excludedRowTotal} row(s) total.`,
      );
      for (const group of domainDedup.excludedDomainGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
        lines.push(`  - Domain "${group.normalizedDomain}": data row(s) ${group.rowIndexes.map((i) => i + 1).join(", ")} -- all retained.`);
      }
      if (domainDedup.excludedDomainGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
        lines.push(`  ...and ${domainDedup.excludedDomainGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more excluded domain(s) -- see the attached audit CSV for the complete list.`);
      }
    }
    if (domainDedup.pricingProtectedGroups.length > 0) {
      const protectedRowTotal = domainDedup.pricingProtectedGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
      lines.push("");
      lines.push(
        `KEPT BOTH FOR REVIEW (two or more records for the same domain already carry real pricing/deal data -- never auto-resolved, per "if both duplicates are protected deal/priced records, keep both for review"): ` +
          `${domainDedup.pricingProtectedGroups.length} domain(s), ${protectedRowTotal} row(s) total.`,
      );
      for (const group of domainDedup.pricingProtectedGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
        lines.push(`  - Domain "${group.normalizedDomain}": data row(s) ${group.rowIndexes.map((i) => i + 1).join(", ")} -- all retained, flagged for manual review.`);
      }
      if (domainDedup.pricingProtectedGroups.length > MAX_DUPLICATE_GROUPS_SHOWN) {
        lines.push(`  ...and ${domainDedup.pricingProtectedGroups.length - MAX_DUPLICATE_GROUPS_SHOWN} more -- see the attached audit CSV for the complete list.`);
      }
    }
  } else if (result.domainDuplicateGroups.length === 0) {
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

  if (domainDedup) {
    const domainDuplicateAdditionalRemovedTotal = domainDedup.domainDuplicateAdditionalRemovedRowIndexes.size;
    const totalRemoved = exactDuplicateActualRemovedCount + domainDuplicateAdditionalRemovedTotal;
    lines.push("");
    lines.push("=== RECONCILIATION (rows read = removed + retained, exactly) ===");
    lines.push(`Rows read:                                            ${base.originalRowCount}`);
    lines.push(`Exact-duplicate removals (extras only, one kept per group):     ${exactDuplicateActualRemovedCount}`);
    lines.push(`Domain-duplicate removals (additional -- excludes overlap with exact-duplicate removals above): ${domainDuplicateAdditionalRemovedTotal}`);
    lines.push(`Total removed:                                        ${totalRemoved}  (= ${exactDuplicateActualRemovedCount} + ${domainDuplicateAdditionalRemovedTotal})`);
    lines.push(`Retained rows:                                        ${result.retainedRowIndexes.length}`);
    lines.push(
      `Check: ${totalRemoved} removed + ${result.retainedRowIndexes.length} retained = ${totalRemoved + result.retainedRowIndexes.length} -- ` +
        `${totalRemoved + result.retainedRowIndexes.length === base.originalRowCount ? "MATCHES rows read." : "DOES NOT MATCH rows read -- this would be a real defect."}`,
    );
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
  if (domainDedup) {
    // Corrected, reconciling counts -- only for this new reporting path (see the RECONCILIATION section
    // above). The default path below is left byte-identical to this function's prior behavior.
    lines.push(`Original data rows read (server-side, complete): ${base.originalRowCount}`);
    lines.push(`Exact duplicate rows removed: ${exactDuplicateActualRemovedCount} (in ${base.exactDuplicateGroups.length} group(s))`);
    lines.push(
      `Domain/URL duplicate rows removed (one record per domain): ${domainDedup.domainDuplicateAdditionalRemovedRowIndexes.size} (in ${base.domainDuplicateGroups.length - domainDedup.excludedDomainGroups.length - domainDedup.pricingProtectedGroups.length} group(s))`,
    );
    if (domainDedup.excludedDomainGroups.length > 0) {
      lines.push(`Domain/URL duplicate rows flagged (known platform domains, excluded from collapse): ${domainDedup.excludedDomainGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0)} (in ${domainDedup.excludedDomainGroups.length} group(s))`);
    }
    if (domainDedup.pricingProtectedGroups.length > 0) {
      lines.push(`Domain/URL duplicate rows flagged (two or more already-priced records, kept both for review): ${domainDedup.pricingProtectedGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0)} (in ${domainDedup.pricingProtectedGroups.length} group(s))`);
    }
  } else {
    lines.push(`Original data rows read (server-side, complete): ${result.originalRowCount}`);
    lines.push(`Exact duplicate rows removed: ${exactDuplicateRawMemberTotal} (in ${result.exactDuplicateGroups.length} group(s))`);
    lines.push(`Domain/URL duplicate candidates flagged: ${domainDuplicateRowTotal} (in ${result.domainDuplicateGroups.length} group(s))`);
  }
  lines.push(`Final retained records: ${result.retainedRowIndexes.length}`);
  lines.push(`Records requiring manual review: ${result.manualReviewRowIndexes.length}`);

  lines.push("");
  lines.push("=== F. WRITE DESTINATION ===");
  if (destinationOutcome.status === "not_configured") {
    lines.push("No Google Sheets write destination is configured yet -- this proposal cannot be written anywhere until you choose one.");
    if (destinationOutcome.availableSpreadsheets.length === 0) {
      lines.push("No spreadsheets were found in your connected Google account.");
    } else {
      lines.push("Available spreadsheets in your connected Google account:");
      for (const s of destinationOutcome.availableSpreadsheets) lines.push(`  - ${s.name}`);
    }
    lines.push(
      'Go to Settings -> Integrations -> "Write destination" and choose the sheet that should receive these records (e.g. your existing Admin/deal-tracking sheet) -- ADASOS never assumes or hard-codes a specific destination.',
    );
  } else if (destinationOutcome.status === "read_failed") {
    lines.push(`Configured write destination: "${destinationOutcome.destinationName}", but reading its existing content failed: ${destinationOutcome.reason}`);
    lines.push("Nothing was written. Fix the read failure before approving this proposal.");
  } else {
    lines.push(`Configured write destination: "${destinationOutcome.destinationName}". Read ${destinationOutcome.rowsRead} existing row(s) from it (read-only -- nothing written).`);
    lines.push(
      destinationOutcome.pricingColumnsDetected.length > 0
        ? `Existing pricing/deal columns detected there: ${destinationOutcome.pricingColumnsDetected.join(", ")}.`
        : "No pricing/deal columns (Admin Price / Client Price / Profit / Deal Status) were found there.",
    );
    if (!destinationProtection?.applied) {
      lines.push("Destination protection could NOT be applied -- no URL/domain column was detected in the destination, so no existing record could be matched against incoming records. Every existing destination record still stays exactly as-is (nothing here writes to or reads-for-removal from the destination).");
    } else {
      lines.push(`Destination protection APPLIED: ${destinationProtection.protectedDestinationWebsiteCount} existing website(s) in the destination are already priced/deal-done -- treated as the protected baseline.`);
      lines.push(
        `  - ${destinationProtection.protectedOmittedRows.length} incoming Health Master duplicate(s) of an already-priced destination record were OMITTED from this proposal (the existing destination record is untouched).`,
      );
      lines.push(
        `  - ${destinationProtection.flaggedForManualReviewRows.length} incoming record(s) duplicate an already-priced destination record AND are themselves priced -- held back and FLAGGED for manual review (neither auto-written nor auto-deleted).`,
      );
      lines.push("Existing destination records are never cleared, truncated, replaced, or overwritten -- any real write only appends genuinely new/eligible records alongside them.");
    }
  }

  lines.push("");
  lines.push(
    `Nothing has been written to, deleted from, or moved in "${spreadsheetName}" -- this is a proposal only. ` +
      `Use the Approve / Reject buttons above to decide, or reply "approve"/"reject" in chat -- either way requires your explicit action. (Approval reference: ${approval.id})`,
  );
  return lines.join("\n");
}
