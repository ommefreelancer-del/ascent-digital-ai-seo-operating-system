// SPREADSHEET CLEANING LOGIC (2026-09-02): pure, deterministic functions turning a parsed
// spreadsheet-reader.ts sheet (headers + rows) into the real business-required cleaning result --
// exact-duplicate removal, domain/URL duplicate FLAGGING (never auto-removal), malformed-URL detection,
// and clearly-incomplete-record detection. Never fabricates a value, never enriches from any external
// source, never silently deletes a row -- only exact-duplicate EXTRA occurrences (rows 2..N of an
// identical group) are removed from the retained set; every other flagged row stays in the clean
// dataset, marked for manual review. No network access, no external library -- this operates entirely
// on already-parsed in-memory string[][] rows.
//
// COLUMN-DETECTION CAVEAT (deliberate, documented): this codebase has no fixed business schema for an
// arbitrary uploaded prospect sheet, so the "URL/domain" column is auto-detected by header name
// (containing "url"/"website"/"domain"/"link"/"site") rather than assumed to be a specific column
// index. When no such header exists, domain-duplicate and malformed-URL detection both honestly produce
// EMPTY results (never a guess) -- incomplete-record detection still runs using the generic
// mostly-blank-row heuristic below.

import { findExactDuplicateRows, type DuplicateRowGroup } from "./spreadsheet-reader";

export interface MalformedUrlFlag {
  readonly rowIndex: number;
  readonly rawValue: string;
}

export interface IncompleteRowFlag {
  readonly rowIndex: number;
  readonly reason: string;
}

export interface DomainDuplicateGroup {
  readonly normalizedDomain: string;
  readonly rowIndexes: readonly number[];
}

export interface CleaningResult {
  readonly headers: readonly string[];
  readonly originalRowCount: number;
  readonly urlColumnIndex: number | null;
  readonly exactDuplicateGroups: readonly DuplicateRowGroup[];
  readonly domainDuplicateGroups: readonly DomainDuplicateGroup[];
  readonly malformedUrlRows: readonly MalformedUrlFlag[];
  readonly incompleteRows: readonly IncompleteRowFlag[];
  readonly retainedRowIndexes: readonly number[];
  readonly retainedRows: readonly (readonly string[])[];
  readonly manualReviewRowIndexes: readonly number[];
}

/**
 * ROW COLUMN-OFFSET REALIGNMENT (2026-09-15): a real, live-confirmed production defect -- a real Health
 * Master Sheet cleaning run (5,786 source rows) produced an Admin/Vendor + Client Websites split where the
 * vast majority of rows (3,755 of 5,222 retained rows -- 72%) had "Organic Traffic" populated but "Clean
 * URL"/"Original URL" blank, and the write-back counts (3,888 / 1,334) did not reflect genuine
 * <1,000-vs->=1,000 traffic classification. Root cause, confirmed by reproducing it against the actual
 * persisted CleaningResult snapshot: a later section of the real source sheet was pasted starting 3
 * columns to the right of the header's own column A (columns A-C genuinely blank for every row in that
 * section) -- Google Sheets' values.get returns each row as an array from column A through that row's own
 * last non-empty cell, so those rows came back 20 cells long instead of 17, with every real field (URL,
 * DA, traffic, etc.) sitting 3 positions later than the header-derived fixed column indexes
 * (urlColumnIndex, the traffic alias's source index, ...) assume. Every consumer that reads a fixed column
 * index against the ORIGINAL header (urlColumnIndex-based malformed/incomplete/domain-duplicate detection
 * here, and the final business-schema mapping downstream) silently read the WRONG cell for a shifted row --
 * blank for URL (landing on one of the row's genuinely-blank leading cells), and a completely different
 * metric (e.g. "Domain Referring Pages") for "Organic Traffic". A repeated section-header row from the
 * same shifted section was ALSO missed by isEmbeddedHeaderRow() below, since that check requires an EXACT
 * length match against the primary header -- a 20-cell shifted header-repeat never matched a 17-cell
 * header, so it survived as a bogus "record" too.
 *
 * Fixed by realigning any row that is LONGER than the header by stripping exactly that many LEADING cells
 * -- but ONLY when every one of those leading cells is genuinely empty (a row that's merely longer for
 * some other reason, with real content in what would become a stripped cell, is left completely
 * unchanged -- never a guess, never fabricated realignment). Runs once, as the very first step of
 * buildCleaningResult(), so urlColumnIndex-based detection, domain-duplicate detection,
 * isEmbeddedHeaderRow() (via the business-schema mapping downstream), and the final Clean URL/Original
 * URL/Organic Traffic mapping all see the SAME, correctly-realigned row -- one fix, not five separate
 * patches. A row that is SHORTER than the header (genuinely missing trailing columns in the source sheet)
 * is a completely different, already-correctly-handled case and is left untouched here.
 */
export function realignColumnShiftedRow(row: readonly string[], headerLength: number): readonly string[] {
  if (row.length <= headerLength) return row;
  const shiftAmount = row.length - headerLength;
  for (let i = 0; i < shiftAmount; i++) {
    if ((row[i] ?? "") !== "") return row;
  }
  return row.slice(shiftAmount);
}

const DOMAIN_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Real, deterministic domain normalization via the standard URL parser -- lowercased, "www." stripped, no path/query/fragment. Returns null for anything that isn't a real-looking domain (malformed). */
export function normalizeDomain(rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (!hostname) return null;
  const labels = hostname.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => DOMAIN_LABEL_PATTERN.test(label))) return null;
  return hostname;
}

const URL_COLUMN_HEADER_PATTERN = /\b(url|website|domain|link|site)\b/i;

/** Auto-detects which column represents a URL/domain by header name -- never assumes a fixed index, since this build has no fixed business schema for an arbitrary uploaded sheet. Returns null (never guesses) when no header matches. */
export function detectUrlColumnIndex(headers: readonly string[]): number | null {
  const index = headers.findIndex((header) => URL_COLUMN_HEADER_PATTERN.test(header));
  return index === -1 ? null : index;
}

/** A malformed URL is a NON-EMPTY value in the detected URL/domain column that normalizeDomain() cannot parse into a real domain. An empty cell is "incomplete", not "malformed" -- the two categories are deliberately disjoint. */
export function findMalformedUrlRows(rows: readonly (readonly string[])[], urlColumnIndex: number | null): MalformedUrlFlag[] {
  if (urlColumnIndex === null) return [];
  const flags: MalformedUrlFlag[] = [];
  rows.forEach((row, rowIndex) => {
    const raw = (row[urlColumnIndex] ?? "").trim();
    if (raw === "") return;
    if (normalizeDomain(raw) === null) {
      flags.push({ rowIndex, rawValue: raw });
    }
  });
  return flags;
}

/** A row is "clearly incomplete" when its own URL/domain column is blank, or (with no such column detected) when fewer than half its cells have any value at all -- a conservative, schema-agnostic heuristic that never assumes which OTHER fields are individually required. */
export function findIncompleteRows(rows: readonly (readonly string[])[], urlColumnIndex: number | null): IncompleteRowFlag[] {
  const flags: IncompleteRowFlag[] = [];
  rows.forEach((row, rowIndex) => {
    if (urlColumnIndex !== null) {
      if ((row[urlColumnIndex] ?? "").trim() === "") {
        flags.push({ rowIndex, reason: "Missing a value in the detected URL/domain column." });
        return;
      }
    }
    const totalCount = row.length;
    const filledCount = row.filter((cell) => cell.trim() !== "").length;
    if (totalCount > 0 && filledCount / totalCount < 0.5) {
      flags.push({ rowIndex, reason: `Only ${filledCount} of ${totalCount} columns have a value.` });
    }
  });
  return flags;
}

/**
 * Rows sharing the SAME normalized domain where the rows are NOT all identical to each other (i.e. real
 * field differences exist) -- flagged for human review, NEVER auto-removed (distinct from an exact
 * duplicate, which IS safe to auto-collapse to one occurrence). A domain group where every member is
 * already provably an exact duplicate of another member is skipped here -- it's already fully accounted
 * for by the exact-duplicate category, so it is not reported twice under two different labels.
 */
export function findDomainDuplicateCandidates(
  rows: readonly (readonly string[])[],
  urlColumnIndex: number | null,
  exactDuplicateRowIndexes: ReadonlySet<number>,
): DomainDuplicateGroup[] {
  if (urlColumnIndex === null) return [];
  const byDomain = new Map<string, number[]>();
  rows.forEach((row, rowIndex) => {
    const raw = (row[urlColumnIndex] ?? "").trim();
    if (!raw) return;
    const domain = normalizeDomain(raw);
    if (!domain) return;
    const existing = byDomain.get(domain);
    if (existing) existing.push(rowIndex);
    else byDomain.set(domain, [rowIndex]);
  });

  const groups: DomainDuplicateGroup[] = [];
  for (const [normalizedDomain, rowIndexes] of byDomain) {
    if (rowIndexes.length < 2) continue;
    const allAlreadyExact = rowIndexes.every((i) => exactDuplicateRowIndexes.has(i));
    if (allAlreadyExact) continue;
    groups.push({ normalizedDomain, rowIndexes });
  }
  return groups;
}

/** The one, real, end-to-end cleaning computation -- deterministic, side-effect-free, never touches the filesystem/network/db. Same input always produces the identical result. */
export function buildCleaningResult(headers: readonly string[], sourceRows: readonly (readonly string[])[]): CleaningResult {
  const rows = sourceRows.map((row) => realignColumnShiftedRow(row, headers.length));
  const exactDuplicateGroups = findExactDuplicateRows(rows);
  const exactDuplicateExtraIndexes = new Set<number>();
  const allExactDuplicateRowIndexes = new Set<number>();
  for (const group of exactDuplicateGroups) {
    const [, ...extras] = group.rowIndexes;
    for (const i of group.rowIndexes) allExactDuplicateRowIndexes.add(i);
    for (const i of extras) exactDuplicateExtraIndexes.add(i);
  }

  const urlColumnIndex = detectUrlColumnIndex(headers);
  const malformedUrlRows = findMalformedUrlRows(rows, urlColumnIndex);
  const incompleteRows = findIncompleteRows(rows, urlColumnIndex);
  const domainDuplicateGroups = findDomainDuplicateCandidates(rows, urlColumnIndex, allExactDuplicateRowIndexes);

  const retainedRowIndexes = rows.map((_, i) => i).filter((i) => !exactDuplicateExtraIndexes.has(i));
  const retainedRows = retainedRowIndexes.map((i) => rows[i]!);

  const manualReviewSet = new Set<number>();
  for (const group of domainDuplicateGroups) for (const i of group.rowIndexes) manualReviewSet.add(i);
  for (const flag of malformedUrlRows) manualReviewSet.add(flag.rowIndex);
  for (const flag of incompleteRows) manualReviewSet.add(flag.rowIndex);

  return {
    headers,
    originalRowCount: rows.length,
    urlColumnIndex,
    exactDuplicateGroups,
    domainDuplicateGroups,
    malformedUrlRows,
    incompleteRows,
    retainedRowIndexes,
    retainedRows,
    manualReviewRowIndexes: Array.from(manualReviewSet).sort((a, b) => a - b),
  };
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: readonly string[]): string {
  return `${fields.map(csvEscape).join(",")}\r\n`;
}

const AUDIT_CSV_COLUMNS = ["Category", "Original Row (data row #, header excluded)", "Matching Row(s)", "Duplicate Type", "Normalized Domain/URL", "Reason", "Proposed Action", "Final Disposition"];

/**
 * A real, reviewable CSV cleaning audit -- every proposed removal/merge and every flagged row, grouped
 * into the four required sections (A exact duplicates removed, B domain/URL duplicate candidates
 * retained for review, C malformed/incomplete records, D valid retained records). Never invents a
 * reason/value not already present on the real CleaningResult -- this is purely a structural
 * re-rendering of buildCleaningResult()'s own output, nothing computed fresh.
 */
export function buildCleaningAuditCsv(result: CleaningResult): string {
  const lines: string[] = [csvRow(AUDIT_CSV_COLUMNS)];

  for (const group of result.exactDuplicateGroups) {
    const [keptIndex, ...removedIndexes] = group.rowIndexes;
    for (const removedIndex of removedIndexes) {
      lines.push(
        csvRow([
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

  for (const group of result.domainDuplicateGroups) {
    for (const rowIndex of group.rowIndexes) {
      const others = group.rowIndexes.filter((i) => i !== rowIndex).map((i) => i + 1);
      lines.push(
        csvRow([
          "B_DOMAIN_DUPLICATE_CANDIDATE",
          String(rowIndex + 1),
          others.join(";"),
          "Domain/URL duplicate candidate",
          group.normalizedDomain,
          "Same normalized domain, but other column values differ.",
          "Keep -- review manually",
          "Retained (flagged for review)",
        ]),
      );
    }
  }

  for (const flag of result.malformedUrlRows) {
    lines.push(
      csvRow(["C_MALFORMED_OR_INCOMPLETE", String(flag.rowIndex + 1), "", "Malformed URL", flag.rawValue, "Value does not parse as a real domain/URL.", "Keep -- review manually", "Retained (flagged for review)"]),
    );
  }
  for (const flag of result.incompleteRows) {
    lines.push(csvRow(["C_MALFORMED_OR_INCOMPLETE", String(flag.rowIndex + 1), "", "Incomplete record", "", flag.reason, "Keep -- review manually", "Retained (flagged for review)"]));
  }

  const flaggedIndexes = new Set(result.manualReviewRowIndexes);
  for (const rowIndex of result.retainedRowIndexes) {
    if (!flaggedIndexes.has(rowIndex)) {
      lines.push(csvRow(["D_VALID_RETAINED", String(rowIndex + 1), "", "", "", "No issues detected.", "Keep", "Retained"]));
    }
  }

  return lines.join("");
}
