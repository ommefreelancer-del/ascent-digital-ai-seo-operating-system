// EXISTING-OUTPUT-TAB SELF-CLEANUP (2026-09-21): a real, explicitly-requested new capability -- every
// prior Google Sheets write in this codebase only ever APPENDS newly-cleaned records from a SOURCE sheet
// (e.g. "Health Master Sheet") into a write destination (google-sheets-cleaning.ts,
// spreadsheet-google-sheets-writeback.ts). Neither path has ever read back one of ADASOS's OWN
// already-written output tabs (ADMIN_VENDOR_SHEET_NAME / CLIENT_WEBSITES_SHEET_NAME), checked it for
// duplicate rows against ITSELF, and rewritten it -- a real, confirmed gap: a user's real, final "Admin -
// Vendor"/"Client Sheet" tabs (downloaded and analyzed offline this session) still contained hundreds of
// real duplicate rows with no ADASOS capability to remove them.
//
// This module closes that gap, narrowly and explicitly:
//   1. proposeExistingOutputTabCleanup() reads ONE named tab from the user's configured write destination
//      (read-only -- getAllSpreadsheetValues() with the new sheetName targeting option), runs it through
//      the SAME already-tested dedup engine every other cleaning path already uses (buildCleaningResult()
//      -- realignment, exact-duplicate removal, domain-duplicate flagging -- no new dedup algorithm here),
//      and persists a real PENDING SpreadsheetCleaningApproval row, exactly like every other cleaning
//      proposal in this codebase. NOTHING is written anywhere by this step.
//   2. writeApprovedExistingOutputTabCleanupToGoogleSheets() performs the actual write, ONLY after the
//      approval has been explicitly approved: it CLEARS the named tab and rewrites it with exactly the
//      retained (de-duplicated) rows from the approved snapshot (google-sheets.ts's new
//      clearAndReplaceSheetValues() -- the first real "clear and replace" Sheets call in this codebase).
//      This is a genuinely different, higher-risk operation than the existing append-only write-back, so
//      it is kept in its own function with its own eligibility check -- never merged into
//      writeApprovedCleaningToGoogleSheets(), which stays exactly as it was for the source-into-destination
//      flow.
//
// NO SCHEMA CHANGE: this reuses the existing Attachment/SpreadsheetCleaningApproval tables exactly as they
// are. Attachment.fileType gets a new, distinct marker value (EXISTING_OUTPUT_CLEANUP_FILE_TYPE, alongside
// the existing "google-sheet" marker used by the source-into-destination flow) so a later approve/write
// step can tell which real write behavior (append-split vs. clear-and-replace) applies to a given approval
// -- see writeApprovedCleaningRespectingMode() below, the single place that branches on it.
// Attachment.originalFileName is reused to carry the TAB NAME being cleaned (e.g. "Admin - Vendor") --
// the same role it already plays for every other Attachment row (the human-readable name of what's being
// processed), never a new field.

import { db } from "@/server/db";
import { getAllSpreadsheetValues, getWriteDestinationSpreadsheet, clearAndReplaceSheetValues, assertSheetsWriteScope, type AllSpreadsheetValuesResult } from "@/server/google-sheets";
import { getAttachmentMeta } from "./attachments";
import { buildCleaningResult, buildCleaningAuditCsv, type CleaningResult, type DomainDuplicateGroup } from "./spreadsheet-cleaning";
import { buildXlsxWorkbook } from "./xlsx-writer";
import { createPendingCleaningApproval } from "./spreadsheet-cleaning-approval";
import { saveCleaningArtifacts } from "./spreadsheet-cleaning-artifacts";
import { buildSpreadsheetCleaningApprovalMeta, type SpreadsheetProcessingResult } from "./spreadsheet-cleaning-approval-meta";
import { writeApprovedCleaningToGoogleSheets, type WriteBackResult } from "./spreadsheet-google-sheets-writeback";
import { markCleaningApprovalWritten, markCleaningApprovalWriteFailed, type CleaningApprovalRecord } from "./spreadsheet-cleaning-approval";
import { ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME } from "./spreadsheet-business-schema";

/**
 * FULL DOMAIN DEDUP (2026-09-21): a real, explicitly-requested extension -- buildCleaningResult()'s own
 * domainDuplicateGroups are deliberately never auto-removed (see spreadsheet-cleaning.ts's own header: rows
 * sharing a domain but differing in other fields are "flagged for human review, NEVER auto-removed" --
 * correct for the general uploaded-file/source-into-destination flows, which have no basis to guess which
 * differing row is canonical). For THIS feature specifically (self-cleanup of a tab ADASOS itself already
 * wrote), the user explicitly asked for a stronger policy: exactly one row per website/domain. This is kept
 * OUT of the shared spreadsheet-cleaning.ts engine (never changes buildCleaningResult()'s behavior for any
 * other caller -- Health Master source cleaning, XLSX-attachment cleaning, etc. all stay exactly as they
 * were) and lives here, as an explicit, opt-in second pass applied on top of the already-computed result.
 *
 * Selection rule, stated plainly (never silently guessed): within each domain-duplicate group, the row with
 * the LOWEST original data-row index is kept as the canonical record; every other row sharing that
 * normalized domain is removed. This mirrors the exact-duplicate engine's own established convention
 * (buildCleaningResult() already keeps the lowest-indexed row of an exact-duplicate group) rather than
 * inventing a new, unstated rule (e.g. "highest DA" or "most complete row") that would require guessing
 * which field matters most.
 */
export interface DomainDedupedCleaningResult {
  /** The result BEFORE this pass -- exact-duplicate removal only, domain groups still just flagged. Kept so callers/report builders can still show the real, full duplicate-group data. */
  readonly base: CleaningResult;
  /** The result AFTER this pass -- retainedRowIndexes/retainedRows/manualReviewRowIndexes reflect exactly one row kept per domain, on top of the existing exact-duplicate removal. */
  readonly result: CleaningResult;
  /** The one row per domain group that was kept (for reporting -- always already present in base.retainedRowIndexes; see this function's own proof in its implementation comment). */
  readonly domainDuplicateKeptRowIndexes: ReadonlySet<number>;
  /** Every other row in a domain group -- removed by this pass (a row already removed by exact-duplicate collapse may appear here too; removing it again is a safe no-op). RAW group membership -- do NOT sum this size with exactDuplicateGroups' own row count for a headline total, since the two sets can overlap (a row can be both an exact-duplicate extra AND a non-canonical domain-group member). Use domainDuplicateAdditionalRemovedRowIndexes below for a reconciling total instead. */
  readonly domainDuplicateRemovedRowIndexes: ReadonlySet<number>;
  /** The subset of domainDuplicateRemovedRowIndexes that were STILL present in base.retainedRowIndexes (i.e. not already removed by exact-duplicate collapse) -- the TRUE incremental number of rows this pass removes on top of exact-duplicate removal. By construction, exactDuplicateGroups' own removed-row count + this set's size + result.retainedRowIndexes.length always equals base.originalRowCount exactly -- this is the set to use for any reconciling summary total. */
  readonly domainDuplicateAdditionalRemovedRowIndexes: ReadonlySet<number>;
  /** Domain groups that were deliberately left alone (not collapsed) because their normalized domain is in excludedDomains -- still flagged, exactly like the default (no-collapse) mode, never removed. */
  readonly excludedDomainGroups: readonly DomainDuplicateGroup[];
}

export interface CollapseDomainDuplicatesOptions {
  /** Normalized domains (e.g. "linkedin.com") to leave alone -- their groups stay flagged-only, exactly like the default mode, never collapsed to one row. Case-insensitive; compared against the same normalizeDomain() output buildCleaningResult() already used to form the group. */
  readonly excludedDomains?: ReadonlySet<string>;
}

export function collapseDomainDuplicatesToOnePerDomain(base: CleaningResult, options?: CollapseDomainDuplicatesOptions): DomainDedupedCleaningResult {
  const excludedDomains = options?.excludedDomains;
  const domainDuplicateKeptRowIndexes = new Set<number>();
  const domainDuplicateRemovedRowIndexes = new Set<number>();
  const excludedDomainGroups: DomainDuplicateGroup[] = [];
  for (const group of base.domainDuplicateGroups) {
    if (excludedDomains?.has(group.normalizedDomain)) {
      excludedDomainGroups.push(group);
      continue;
    }
    const sorted = [...group.rowIndexes].sort((a, b) => a - b);
    const [keep, ...extras] = sorted;
    // `keep` (the group's lowest original row index) is always already present in base.retainedRowIndexes:
    // if it were part of an exact-duplicate group, it would also be the LOWEST member there (it's the
    // lowest in the superset), so buildCleaningResult()'s own exact-duplicate pass would already have kept
    // it, never removed it. This is why the filter below only ever needs to REMOVE indexes, never add one
    // back.
    if (keep !== undefined) domainDuplicateKeptRowIndexes.add(keep);
    for (const i of extras) domainDuplicateRemovedRowIndexes.add(i);
  }

  // RECONCILIATION FIX (2026-09-21): a real, live-confirmed reporting defect -- a report built from
  // exactDuplicateGroups' row count PLUS domainDuplicateRemovedRowIndexes.size did not sum to the real
  // (originalRowCount - retainedRowIndexes.length) total, because domainDuplicateRemovedRowIndexes counts
  // EVERY non-canonical group member regardless of whether exact-duplicate collapse already removed it --
  // a row can be both an exact-duplicate extra and a domain-group member, so summing the two RAW counts
  // double-counts it. domainDuplicateAdditionalRemovedRowIndexes below is the TRUE incremental set (members
  // still present in base.retainedRowIndexes right before this pass), so exact-removed-count +
  // domainDuplicateAdditionalRemovedRowIndexes.size + result.retainedRowIndexes.length always reconciles to
  // exactly base.originalRowCount -- never approximately, by construction (retainedRowIndexes below is
  // filtered from base.retainedRowIndexes using the exact same set).
  const baseRetainedSet = new Set(base.retainedRowIndexes);
  const domainDuplicateAdditionalRemovedRowIndexes = new Set([...domainDuplicateRemovedRowIndexes].filter((i) => baseRetainedSet.has(i)));

  const retainedPairs = base.retainedRowIndexes
    .map((rowIndex, position) => [rowIndex, base.retainedRows[position]!] as const)
    .filter(([rowIndex]) => !domainDuplicateRemovedRowIndexes.has(rowIndex));
  const retainedRowIndexes = retainedPairs.map(([rowIndex]) => rowIndex);
  const retainedRows = retainedPairs.map(([, row]) => row);

  const manualReviewSet = new Set<number>();
  for (const flag of base.malformedUrlRows) manualReviewSet.add(flag.rowIndex);
  for (const flag of base.incompleteRows) manualReviewSet.add(flag.rowIndex);
  // Excluded domain groups were deliberately left uncollapsed -- still genuinely ambiguous (same domain,
  // differing fields), so they stay flagged for manual review exactly like the default (no-collapse) mode.
  for (const group of excludedDomainGroups) for (const i of group.rowIndexes) manualReviewSet.add(i);

  const result: CleaningResult = {
    ...base,
    retainedRowIndexes,
    retainedRows,
    manualReviewRowIndexes: Array.from(manualReviewSet).sort((a, b) => a - b),
  };

  return { base, result, domainDuplicateKeptRowIndexes, domainDuplicateRemovedRowIndexes, domainDuplicateAdditionalRemovedRowIndexes, excludedDomainGroups };
}

const FULLY_DEDUPED_AUDIT_CSV_COLUMNS = ["Category", "Original Row (data row #, header excluded)", "Matching Row(s)", "Duplicate Type", "Normalized Domain/URL", "Reason", "Proposed Action", "Final Disposition"];

function csvEscapeLocal(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRowLocal(fields: readonly string[]): string {
  return `${fields.map(csvEscapeLocal).join(",")}\r\n`;
}

/**
 * A real, reviewable CSV cleaning audit for the full-domain-dedup mode -- structurally mirrors
 * spreadsheet-cleaning.ts's buildCleaningAuditCsv(), but (unlike that shared function, which is never
 * changed here) labels every non-canonical domain-duplicate row as REMOVED rather than "flagged for
 * review", matching what this mode's write-back actually does -- EXCEPT for a group whose domain was
 * excluded from collapsing (see collapseDomainDuplicatesToOnePerDomain's excludedDomains option), which is
 * reported as flagged-for-review, matching what actually happened to it (nothing removed).
 */
function buildFullyDedupedCleaningAuditCsv(base: CleaningResult, finalRetainedRowIndexes: ReadonlySet<number>, excludedDomains?: ReadonlySet<string>): string {
  const lines: string[] = [csvRowLocal(FULLY_DEDUPED_AUDIT_CSV_COLUMNS)];

  for (const group of base.exactDuplicateGroups) {
    const [keptIndex, ...removedIndexes] = group.rowIndexes;
    for (const removedIndex of removedIndexes) {
      lines.push(
        csvRowLocal([
          "A_EXACT_DUPLICATE_REMOVED",
          String(removedIndex + 1),
          String(keptIndex! + 1),
          "Exact duplicate",
          "",
          `Identical values in every column as data row ${keptIndex! + 1}.`,
          "Remove -- one occurrence retained",
          "Removed",
        ]),
      );
    }
  }

  const domainFlaggedIndexes = new Set<number>();
  for (const group of base.domainDuplicateGroups) {
    const sorted = [...group.rowIndexes].sort((a, b) => a - b);
    const [keptIndex, ...restIndexes] = sorted;
    const isExcluded = excludedDomains?.has(group.normalizedDomain) ?? false;
    if (isExcluded) {
      // Nothing in this group was removed -- report EVERY member as flagged (matching the shared engine's
      // own default convention), not just the non-canonical ones, so none silently falls through to
      // D_VALID_RETAINED as if it had no duplicate concern at all.
      for (const rowIndex of sorted) {
        domainFlaggedIndexes.add(rowIndex);
        lines.push(
          csvRowLocal([
            "B_DOMAIN_DUPLICATE_FLAGGED",
            String(rowIndex + 1),
            sorted.filter((i) => i !== rowIndex).map((i) => i + 1).join(";"),
            "Domain/URL duplicate",
            group.normalizedDomain,
            "Excluded from domain-level collapsing (known large platform domain) -- other fields differ.",
            "Keep -- review manually",
            "Retained (flagged for review)",
          ]),
        );
      }
      continue;
    }
    for (const rowIndex of restIndexes) {
      lines.push(
        csvRowLocal([
          "B_DOMAIN_DUPLICATE_REMOVED",
          String(rowIndex + 1),
          String(keptIndex! + 1),
          "Domain/URL duplicate",
          group.normalizedDomain,
          `Same normalized domain as data row ${keptIndex! + 1} -- kept exactly one record per domain.`,
          "Remove -- one unique record per domain retained",
          "Removed",
        ]),
      );
    }
  }

  const flaggedIndexes = new Set([...base.malformedUrlRows.map((f) => f.rowIndex), ...base.incompleteRows.map((f) => f.rowIndex), ...domainFlaggedIndexes]);
  for (const flag of base.malformedUrlRows) {
    lines.push(
      csvRowLocal([
        "C_MALFORMED_OR_INCOMPLETE",
        String(flag.rowIndex + 1),
        "",
        "Malformed URL",
        flag.rawValue,
        "Value does not parse as a real domain/URL.",
        "Keep -- review manually",
        finalRetainedRowIndexes.has(flag.rowIndex) ? "Retained (flagged for review)" : "Removed (domain/exact duplicate)",
      ]),
    );
  }
  for (const flag of base.incompleteRows) {
    lines.push(
      csvRowLocal([
        "C_MALFORMED_OR_INCOMPLETE",
        String(flag.rowIndex + 1),
        "",
        "Incomplete record",
        "",
        flag.reason,
        "Keep -- review manually",
        finalRetainedRowIndexes.has(flag.rowIndex) ? "Retained (flagged for review)" : "Removed (domain/exact duplicate)",
      ]),
    );
  }

  for (const rowIndex of finalRetainedRowIndexes) {
    if (!flaggedIndexes.has(rowIndex)) {
      lines.push(csvRowLocal(["D_VALID_RETAINED", String(rowIndex + 1), "", "", "", "No issues detected.", "Keep", "Retained"]));
    }
  }

  return lines.join("");
}

/** Distinct from the existing "google-sheet" marker (source-into-destination live cleaning) -- lets writeApprovedCleaningRespectingMode() below tell the two write behaviors apart from the approval's own Attachment row, with no schema change. */
export const EXISTING_OUTPUT_CLEANUP_FILE_TYPE = "google-sheet-existing-tab-cleanup";

/**
 * PLATFORM-DOMAIN EXCLUSION (2026-09-21): a real, explicitly-requested refinement -- the first full-domain
 * -dedup run against real "Admin - Vendor" data showed its biggest reductions came from large,
 * general-purpose multi-tenant platforms (quora.com, facebook.com, linkedin.com, ...), where many DIFFERENT
 * individual pages on the same domain (a specific Quora question, a specific LinkedIn post) were captured as
 * separate, legitimate prospect rows -- collapsing those to one row per domain is a materially different,
 * likely-unwanted outcome compared to a genuine single-site domain like a guest-post blog listed repeatedly.
 *
 * This is a curated, explicit, general-knowledge list of well-known large platforms -- NOT derived from
 * which domains happened to repeat most in any one dataset (that would be circular: a real spam-scraped
 * single site could also repeat hundreds of times and would wrongly look "large" by that measure alone).
 * Deliberately excludes anything not confidently a well-known multi-tenant platform (e.g. a smaller SaaS/
 * tool site that merely repeated often in one real run) -- those stay subject to normal domain-level
 * collapsing rather than being silently guessed into this list. Reviewable and extendable -- pass a
 * different/extra set via ProposeExistingOutputTabCleanupOptions.excludedDomains instead of editing this
 * constant if a specific run needs different exclusions.
 */
export const KNOWN_LARGE_PLATFORM_DOMAINS: readonly string[] = [
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "tumblr.com",
  "youtube.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "github.com",
  "scribd.com",
  "slideshare.net",
  "slideserve.com",
  "wordpress.com",
  "blogspot.com",
  "sites.google.com",
  "docs.google.com",
  "academic.oup.com",
  "tandfonline.com",
  "onlinelibrary.wiley.com",
  "upwork.com",
  "fiverr.com",
];

/** Same honesty convention as every other ceiling in this codebase -- a real, large existing output tab must never be silently truncated. */
const MAX_ROWS_FOR_EXISTING_TAB_READ = 200_000;

const MAX_DUPLICATE_GROUPS_SHOWN = 20;
const MAX_FLAGGED_ROWS_SHOWN = 20;

export interface ProposeExistingOutputTabCleanupOptions {
  /** Default false (preserves the original, already-tested behavior: exact-duplicate removal only, domain
   * duplicates flagged for review but never removed). true applies collapseDomainDuplicatesToOnePerDomain()
   * on top -- exactly one row kept per website/domain, per an explicit user request. See that function's own
   * header for the exact, stated selection rule. */
  readonly dedupeDomainDuplicates?: boolean;
  /** Only meaningful when dedupeDomainDuplicates is true. Normalized domains to leave flagged-only (never
   * collapsed) -- omitted/empty means every domain group is collapsed, including large platforms. Never
   * defaults to KNOWN_LARGE_PLATFORM_DOMAINS automatically: platform exclusion changes what "one record per
   * domain" actually removes, so it stays an explicit, stated opt-in per call rather than a silent default
   * that could surprise an existing caller. Pass KNOWN_LARGE_PLATFORM_DOMAINS explicitly to get that
   * behavior. */
  readonly excludedDomains?: readonly string[];
}

/**
 * Reads ONE named tab (e.g. ADMIN_VENDOR_SHEET_NAME) from the user's configured Google Sheets WRITE
 * DESTINATION, runs the same dedup engine every other cleaning path uses, and persists a real pending
 * approval. Read-only -- never writes, deletes, moves, or overwrites anything. Refuses honestly (never a
 * guess) when no write destination is configured, the tab can't be read, or the tab is genuinely empty.
 */
export async function proposeExistingOutputTabCleanup(userId: string, sheetName: string, options?: ProposeExistingOutputTabCleanupOptions): Promise<SpreadsheetProcessingResult> {
  const destination = await getWriteDestinationSpreadsheet(userId);
  if (!destination) {
    return {
      ok: false,
      reply:
        `No Google Sheets write destination is configured, so there's no spreadsheet to read "${sheetName}" from yet. ` +
        "Go to Settings -> Integrations and choose a write destination first.",
    };
  }

  let readResult: AllSpreadsheetValuesResult;
  try {
    readResult = await getAllSpreadsheetValues(userId, destination.id, { sheetName, maxTotalRows: MAX_ROWS_FOR_EXISTING_TAB_READ });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return { ok: false, reply: `I tried to read the "${sheetName}" tab in "${destination.name}", but the read failed: ${reason}` };
  }

  if (readResult.rowsRead === 0) {
    return { ok: false, reply: `The "${sheetName}" tab in "${destination.name}" is genuinely empty (or doesn't exist yet) -- there's nothing to clean.` };
  }

  const [headerRow, ...dataRows] = readResult.values;
  const headers = (headerRow ?? []).map((cell) => cell ?? "");
  const rows = dataRows.map((row) => row.map((cell) => cell ?? ""));

  const baseCleaningResult = buildCleaningResult(headers, rows);
  const dedupeDomainDuplicates = options?.dedupeDomainDuplicates ?? false;
  const excludedDomains = new Set(options?.excludedDomains ?? []);
  const domainDedup = dedupeDomainDuplicates ? collapseDomainDuplicatesToOnePerDomain(baseCleaningResult, { excludedDomains }) : null;
  const cleaningResult = domainDedup?.result ?? baseCleaningResult;

  const sourceRecord = await db.attachment.create({
    data: {
      userId,
      originalFileName: sheetName,
      fileType: EXISTING_OUTPUT_CLEANUP_FILE_TYPE,
      mimeType: "application/vnd.google-apps.spreadsheet",
      sizeBytes: 0,
      storagePath: "",
    },
  });

  const approval = await createPendingCleaningApproval(userId, sourceRecord.id, cleaningResult);

  const workbook = buildXlsxWorkbook([{ name: sheetName, headers: cleaningResult.headers, rows: cleaningResult.retainedRows }]);
  const auditCsv = domainDedup
    ? buildFullyDedupedCleaningAuditCsv(domainDedup.base, new Set(domainDedup.result.retainedRowIndexes), excludedDomains)
    : buildCleaningAuditCsv(cleaningResult);
  await saveCleaningArtifacts(approval.id, workbook, auditCsv);

  const reply = domainDedup
    ? buildFullyDedupedExistingOutputCleanupReportForChat(sheetName, destination.name, readResult, domainDedup, approval.id, excludedDomains)
    : buildExistingOutputCleanupReportForChat(sheetName, destination.name, readResult, cleaningResult, approval.id);

  return {
    ok: true,
    reply,
    approvalMeta: buildSpreadsheetCleaningApprovalMeta(sheetName, approval),
  };
}

/**
 * A COMPACT, count-based report mirroring the other cleaning-report builders' section structure --
 * deliberately includes an explicit warning that this is a CLEAR-AND-REPLACE operation, never an append,
 * since that is a materially different (and first-of-its-kind) risk than every other write in this
 * codebase.
 */
function buildExistingOutputCleanupReportForChat(sheetName: string, destinationName: string, readResult: AllSpreadsheetValuesResult, result: CleaningResult, approvalId: string): string {
  const lines: string[] = [];
  lines.push(
    `I read the "${sheetName}" tab in "${destinationName}" (ADASOS's own already-written output, not a new source) -- ` +
      `${readResult.batchesRead} real batch(es), ${readResult.rowsRead} row(s) total read server-side.`,
  );
  if (readResult.cappedAtSafetyLimit) {
    lines.push(`NOTE: reading stopped at a real safety limit (${readResult.rowsRead} rows) rather than a confirmed end of data -- this tab may genuinely have more rows beyond what was processed here.`);
  }

  const exactDuplicateRowTotal = result.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
  const removedCount = result.originalRowCount - result.retainedRowIndexes.length;
  const domainDuplicateRowTotal = result.domainDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);

  lines.push("");
  lines.push("=== A. SELF-DEDUP PROPOSAL ===");
  lines.push(`Columns (${result.headers.length}): ${result.headers.join(", ")}`);
  lines.push(`Retained records: ${result.retainedRowIndexes.length} (of ${result.originalRowCount} original rows in this tab -- ${removedCount} exact-duplicate row(s) proposed for removal, everything else preserved).`);
  lines.push("A real, downloadable de-duplicated workbook and a CSV cleaning audit are attached to this message below -- review both before deciding.");

  lines.push("");
  lines.push("=== B. DUPLICATE AUDIT ===");
  if (result.exactDuplicateGroups.length === 0) {
    lines.push("Exact duplicates: none found.");
  } else {
    lines.push(`Exact duplicates: ${result.exactDuplicateGroups.length} group(s), ${exactDuplicateRowTotal} row(s) total -- one canonical occurrence kept per group, the rest proposed for removal.`);
    for (const group of result.exactDuplicateGroups.slice(0, MAX_DUPLICATE_GROUPS_SHOWN)) {
      const [keepRow, ...removedRows] = group.rowIndexes.map((i) => i + 1);
      lines.push(`  - Keep data row ${keepRow}; remove data row(s) ${removedRows.join(", ")} -- reason: identical values in every column.`);
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
  if (result.incompleteRows.length > 0) lines.push("  (see the attached audit CSV for every flagged row)");

  lines.push("");
  lines.push("=== D. WHAT APPROVING THIS DOES (READ CAREFULLY) ===");
  lines.push(
    `Unlike every other cleaning proposal in ADASOS, approving this one does NOT append new rows -- it CLEARS the entire "${sheetName}" tab ` +
      `and REWRITES it with exactly the ${result.retainedRowIndexes.length} retained record(s) above. Every row currently in "${sheetName}" that is ` +
      "not one of the retained records (i.e. every extra exact-duplicate occurrence) will be permanently removed from that tab. Nothing outside " +
      `"${sheetName}" is touched.`,
  );

  lines.push("");
  lines.push(
    `Nothing has been written to, cleared from, or moved in "${sheetName}" yet -- this is a proposal only. ` +
      `Use the Approve / Reject buttons above to decide, or reply "approve"/"reject" in chat -- either way requires your explicit action. (Approval reference: ${approvalId})`,
  );
  return lines.join("\n");
}

/**
 * Same section structure as buildExistingOutputCleanupReportForChat(), for the full-domain-dedup mode --
 * section B now reports domain duplicates as REMOVED (one kept per domain), not merely flagged, and section
 * A's headline count reflects the combined exact + domain removal.
 */
function buildFullyDedupedExistingOutputCleanupReportForChat(sheetName: string, destinationName: string, readResult: AllSpreadsheetValuesResult, domainDedup: DomainDedupedCleaningResult, approvalId: string, excludedDomains: ReadonlySet<string>): string {
  const { base, result } = domainDedup;
  const collapsedGroups = base.domainDuplicateGroups.filter((g) => !excludedDomains.has(g.normalizedDomain));
  const lines: string[] = [];
  lines.push(
    `I read the "${sheetName}" tab in "${destinationName}" (ADASOS's own already-written output, not a new source) -- ` +
      `${readResult.batchesRead} real batch(es), ${readResult.rowsRead} row(s) total read server-side.`,
  );
  if (readResult.cappedAtSafetyLimit) {
    lines.push(`NOTE: reading stopped at a real safety limit (${readResult.rowsRead} rows) rather than a confirmed end of data -- this tab may genuinely have more rows beyond what was processed here.`);
  }

  // RAW group-membership total -- includes the ONE canonical/kept row of every exact-duplicate group, not
  // just the removed "extras". Used only for the "N row(s) total" description in section B below -- NEVER
  // as a removed-row count (that conflation was itself a real reconciliation bug -- see the fix below).
  const exactDuplicateRawMemberTotal = base.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
  // ACTUAL removed count -- one row per group is always kept, so this is raw membership minus the number of
  // groups (exactly what buildCleaningResult()'s own exactDuplicateExtraIndexes tracks internally). This,
  // not exactDuplicateRawMemberTotal, is the number that reconciles with base.originalRowCount below.
  const exactDuplicateActualRemovedCount = exactDuplicateRawMemberTotal - base.exactDuplicateGroups.length;
  // RECONCILING total -- see collapseDomainDuplicatesToOnePerDomain()'s own header on why this (not
  // domainDuplicateRemovedRowIndexes.size) is the number that sums correctly with the exact-removed count.
  const domainDuplicateAdditionalRemovedTotal = domainDedup.domainDuplicateAdditionalRemovedRowIndexes.size;
  // RAW total -- every non-canonical member of every collapsed domain group, INCLUDING rows also counted
  // under exact-duplicate removal. Shown separately (never summed into the headline) purely so the
  // per-domain group listing below (which lists every raw member) isn't seen as contradicting the totals.
  const domainDuplicateRawGroupMemberTotal = collapsedGroups.reduce((sum, g) => sum + g.rowIndexes.length - 1, 0);
  const overlapWithExactDuplicates = domainDuplicateRawGroupMemberTotal - domainDuplicateAdditionalRemovedTotal;
  const totalRemoved = exactDuplicateActualRemovedCount + domainDuplicateAdditionalRemovedTotal;

  lines.push("");
  lines.push("=== A. SELF-DEDUP PROPOSAL (FULL DOMAIN DEDUP) ===");
  lines.push(`Columns (${result.headers.length}): ${result.headers.join(", ")}`);
  lines.push(
    `Retained records: ${result.retainedRowIndexes.length} (of ${base.originalRowCount} original rows in this tab -- ${totalRemoved} row(s) proposed for removal: ` +
      `${exactDuplicateActualRemovedCount} exact-duplicate row(s), plus ${domainDuplicateAdditionalRemovedTotal} additional row(s) removed to keep exactly ONE record per website/domain` +
      (excludedDomains.size > 0 ? `, excluding ${excludedDomains.size} known large platform domain(s) -- see below` : "") +
      ").",
  );
  lines.push(
    'Selection rule for which row is kept per domain: the row with the LOWEST original row number in this tab (same convention already used for exact duplicates) -- never a guess based on which row "looks more complete".',
  );
  lines.push("A real, downloadable de-duplicated workbook and a CSV cleaning audit are attached to this message below -- review both before deciding.");

  lines.push("");
  lines.push("=== B. DUPLICATE AUDIT ===");
  if (base.exactDuplicateGroups.length === 0) {
    lines.push("Exact duplicates: none found.");
  } else {
    lines.push(
      `Exact duplicates: ${base.exactDuplicateGroups.length} group(s), ${exactDuplicateRawMemberTotal} row(s) total (one canonical occurrence per group + its extras) -- ` +
        `${exactDuplicateActualRemovedCount} extra row(s) removed, one kept per group.`,
    );
  }
  lines.push("");
  if (collapsedGroups.length === 0) {
    lines.push("Domain/URL duplicate candidates collapsed to one record per domain: none.");
  } else {
    lines.push(
      `Domain/URL duplicate candidates: ${collapsedGroups.length} group(s), ${domainDuplicateRawGroupMemberTotal} row(s) total beyond the kept one -- ` +
        `${overlapWithExactDuplicates} of those were ALREADY removed as exact duplicates above (not double-counted), so this step removes ` +
        `${domainDuplicateAdditionalRemovedTotal} genuinely ADDITIONAL row(s):`,
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

  lines.push("");
  lines.push("=== C. DATA-QUALITY AUDIT ===");
  lines.push(`Malformed URLs: ${base.malformedUrlRows.length}.`);
  for (const flag of base.malformedUrlRows.slice(0, MAX_FLAGGED_ROWS_SHOWN)) {
    lines.push(`  - Data row ${flag.rowIndex + 1}: "${flag.rawValue}" does not parse as a real domain/URL.`);
  }
  if (base.malformedUrlRows.length > MAX_FLAGGED_ROWS_SHOWN) lines.push(`  ...and ${base.malformedUrlRows.length - MAX_FLAGGED_ROWS_SHOWN} more.`);
  lines.push(`Clearly incomplete records: ${base.incompleteRows.length}.`);
  if (base.incompleteRows.length > 0) lines.push("  (see the attached audit CSV for every flagged row)");

  lines.push("");
  lines.push("=== D. RECONCILIATION (rows read = removed + retained, exactly) ===");
  lines.push(`Rows read:                                            ${base.originalRowCount}`);
  lines.push(`Exact-duplicate removals (extras only, one kept per group):     ${exactDuplicateActualRemovedCount}`);
  lines.push(`Domain-duplicate removals (additional -- excludes overlap with exact-duplicate removals above): ${domainDuplicateAdditionalRemovedTotal}`);
  lines.push(`Total removed:                                        ${totalRemoved}  (= ${exactDuplicateActualRemovedCount} + ${domainDuplicateAdditionalRemovedTotal})`);
  lines.push(`Retained rows:                                        ${result.retainedRowIndexes.length}`);
  lines.push(
    `Check: ${totalRemoved} removed + ${result.retainedRowIndexes.length} retained = ${totalRemoved + result.retainedRowIndexes.length} -- ` +
      `${totalRemoved + result.retainedRowIndexes.length === base.originalRowCount ? "MATCHES rows read." : "DOES NOT MATCH rows read -- this would be a real defect."}`,
  );

  lines.push("");
  lines.push("=== E. WHAT APPROVING THIS DOES (READ CAREFULLY) ===");
  lines.push(
    `Approving this CLEARS the entire "${sheetName}" tab and REWRITES it with exactly the ${result.retainedRowIndexes.length} retained record(s) above -- ` +
      `every extra exact-duplicate occurrence AND every extra same-domain row (i.e. everything except the one kept record per domain) will be permanently removed from that tab. ` +
      `Nothing outside "${sheetName}" is touched.`,
  );

  lines.push("");
  lines.push(
    `Nothing has been written to, cleared from, or moved in "${sheetName}" yet -- this is a proposal only. ` +
      `Use the Approve / Reject buttons above to decide, or reply "approve"/"reject" in chat -- either way requires your explicit action. (Approval reference: ${approvalId})`,
  );
  return lines.join("\n");
}

/**
 * The FIRST real "clear and replace" write in this codebase -- see google-sheets.ts's
 * clearAndReplaceSheetValues() header. Refuses for any status other than "approved"/"write_failed" (a
 * genuine retry), exactly like writeApprovedCleaningToGoogleSheets()'s own eligibility check. On success,
 * reuses the SAME generic markCleaningApprovalWritten()/markCleaningApprovalWriteFailed() functions the
 * append-based path uses -- deliberately does NOT touch adminVendorWrittenAt/clientWebsitesWrittenAt,
 * which are semantically tied to the two-tab append-split flow and would be misleading here (this writes
 * exactly one tab, not a traffic-split pair).
 */
export interface ExistingTabWriteBackResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly tabName: string;
  readonly rowsWritten?: number;
}

const WRITE_ELIGIBLE_STATUSES: readonly CleaningApprovalRecord["status"][] = ["approved", "write_failed"];

export async function writeApprovedExistingOutputTabCleanupToGoogleSheets(userId: string, approval: CleaningApprovalRecord, spreadsheetId: string, sheetName: string): Promise<ExistingTabWriteBackResult> {
  if (!WRITE_ELIGIBLE_STATUSES.includes(approval.status)) {
    return { ok: false, tabName: sheetName, error: `Refusing to write -- this cleaning result's status is "${approval.status}". Nothing was sent to Google Sheets.` };
  }

  try {
    await assertSheetsWriteScope(userId);
    await clearAndReplaceSheetValues(userId, spreadsheetId, sheetName, approval.result.headers, approval.result.retainedRows);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    await markCleaningApprovalWriteFailed(userId, approval.id);
    return { ok: false, tabName: sheetName, error: `The clear-and-replace write to "${sheetName}" failed: ${reason}` };
  }

  const marked = await markCleaningApprovalWritten(userId, approval.id);
  if (!marked.ok) {
    return { ok: false, tabName: sheetName, error: `The write to "${sheetName}" succeeded, but recording it failed: ${marked.error}` };
  }
  return { ok: true, tabName: sheetName, rowsWritten: approval.result.retainedRowIndexes.length };
}

/**
 * SINGLE DISPATCH POINT (2026-09-21): every existing approve/write call site (the chat-text "approve"
 * reply in spreadsheet-processing.ts, and the two form-action buttons in spreadsheet-cleaning-actions.ts)
 * used to call writeApprovedCleaningToGoogleSheets() unconditionally -- correct for every approval that
 * existed before this module, since only the append-split flow existed. Now that a genuinely different
 * write behavior exists for this new approval type, this is the ONE place that decides which real write
 * function applies to a given approval, by reading the approval's own Attachment.fileType marker (no
 * schema change -- see this module's own header). Every call site is updated to call THIS function instead
 * of writeApprovedCleaningToGoogleSheets() directly, so the branch only ever lives in one place.
 */
export type WriteBackDispatchResult = { readonly mode: "append-split"; readonly result: WriteBackResult } | { readonly mode: "existing-tab-replace"; readonly result: ExistingTabWriteBackResult };

export async function writeApprovedCleaningRespectingMode(userId: string, approval: CleaningApprovalRecord, spreadsheetId: string): Promise<WriteBackDispatchResult> {
  const attachment = await getAttachmentMeta(userId, approval.attachmentId);
  if (attachment?.fileType === EXISTING_OUTPUT_CLEANUP_FILE_TYPE) {
    const result = await writeApprovedExistingOutputTabCleanupToGoogleSheets(userId, approval, spreadsheetId, attachment.originalFileName);
    return { mode: "existing-tab-replace", result };
  }
  const result = await writeApprovedCleaningToGoogleSheets(userId, approval, spreadsheetId);
  return { mode: "append-split", result };
}

const ADMIN_VENDOR_MENTION = /\badmin[\s-]*vendor\b/i;
const CLIENT_SHEET_MENTION = /\bclient sheet\b/i;
const DEDUP_ACTION_PHRASES = /\b(duplicate|duplicates|dedup|de-dup|remove\s+duplicate|clean\s*up|rewrite)\b/i;
// FULL DOMAIN DEDUP PHRASING (2026-09-21): a real, explicit request for the stronger "exactly one record
// per domain/website" policy (collapseDomainDuplicatesToOnePerDomain() above), as opposed to the default
// exact-duplicates-only proposal. Deliberately requires "per website"/"per domain"/"one unique ... per" --
// language a plain "remove duplicates" request does not use -- so the weaker default stays the default
// unless the user is explicit about wanting domain-level collapsing too.
const DOMAIN_LEVEL_DEDUP_PHRASES = /\bper\s+(website|domain)\b|\bone\s+(unique\s+)?record\s+per\b|\bone\s+(unique\s+)?row\s+per\b/i;

/**
 * ROUTING TARGET DETECTION (2026-09-21): distinguishes a request to self-dedupe one of ADASOS's OWN
 * already-written output tabs from the pre-existing "clean a SOURCE sheet into the configured destination"
 * flow (processSelectedGoogleSheet() in google-sheets-cleaning.ts) -- which is what
 * looksLikeSpreadsheetOperationRequest() in spreadsheet-processing.ts already detects and stays completely
 * unaffected by this. Deliberately narrow: requires BOTH a real mention of one of the two fixed,
 * system-defined output-tab names (never a user-chosen source/destination name) AND real dedup/cleanup
 * action language -- a bare "email the client sheet" or "the admin vendor spoke to me" does not match.
 * Returns null when neither tab is mentioned, or no dedup action is present.
 */
export interface ExistingOutputTabSelfCleanupTargets {
  readonly adminVendor: boolean;
  readonly clientSheet: boolean;
  /** true when the message explicitly asks for one record per domain/website -- see DOMAIN_LEVEL_DEDUP_PHRASES above. */
  readonly dedupeByDomain: boolean;
}

export function detectExistingOutputTabSelfCleanupRequest(message: string): ExistingOutputTabSelfCleanupTargets | null {
  const adminVendor = ADMIN_VENDOR_MENTION.test(message);
  const clientSheet = CLIENT_SHEET_MENTION.test(message);
  if (!adminVendor && !clientSheet) return null;
  if (!DEDUP_ACTION_PHRASES.test(message)) return null;
  return { adminVendor, clientSheet, dedupeByDomain: DOMAIN_LEVEL_DEDUP_PHRASES.test(message) };
}

/**
 * Real dispatch helper for the chat route: runs proposeExistingOutputTabCleanup() for exactly ONE tab per
 * request, even when both are mentioned. Deliberate, NOT a shortcut -- resolveCleaningApprovalReply() and
 * the bare-text "approve" chat reply resolve against "the single most recent PENDING approval" (see
 * spreadsheet-processing.ts), so proposing two tabs' worth of pending approvals in the same turn would make
 * a later bare "approve" reply ambiguous about which tab it targets -- unacceptable for a real, destructive
 * clear-and-replace write. Admin - Vendor is prioritized when both are mentioned (it was the tab explicitly
 * named in the original request that motivated this feature); the reply explicitly tells the user the other
 * tab was deferred and how to ask for it next.
 */
export async function proposeExistingOutputTabCleanupForChat(userId: string, targets: ExistingOutputTabSelfCleanupTargets): Promise<SpreadsheetProcessingResult> {
  const sheetName = targets.adminVendor ? ADMIN_VENDOR_SHEET_NAME : CLIENT_WEBSITES_SHEET_NAME;
  const result = await proposeExistingOutputTabCleanup(userId, sheetName, { dedupeDomainDuplicates: targets.dedupeByDomain });
  if (targets.adminVendor && targets.clientSheet && result.ok) {
    return {
      ...result,
      reply: `${result.reply}\n\n(You also mentioned "${CLIENT_WEBSITES_SHEET_NAME}" -- to avoid an ambiguous approval once two proposals are pending at once, I've only proposed "${sheetName}" here. Ask me to clean up "${CLIENT_WEBSITES_SHEET_NAME}" separately once you've decided on this one.)`,
    };
  }
  return result;
}
