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

// ===========================================================================================
// DOMAIN-LEVEL DEDUP (2026-09-21, generalized 2026-09-24): buildCleaningResult()'s own
// domainDuplicateGroups are deliberately never auto-removed above -- rows sharing a domain but differing in
// other fields are "flagged for human review, NEVER auto-removed", correct for the general case, which has
// no basis to guess which differing row is canonical. Some callers (an explicit user request for "one
// record per domain/website") want a real, stronger policy instead: exactly one row per domain, kept
// deterministically (never guessed) by taking the LOWEST original row index in each domain group -- the
// same convention buildCleaningResult()'s own exact-duplicate pass already uses. Lives here (not in either
// specific caller module) so BOTH the existing-output-tab self-cleanup flow
// (spreadsheet-existing-output-cleanup.ts) and the source-sheet-into-destination flow
// (google-sheets-cleaning.ts) share the exact same collapse logic, platform-domain list, and phrase
// detection -- never two parallel implementations that could silently drift apart. (A direct import between
// those two modules would form a circular dependency through spreadsheet-google-sheets-writeback.ts ->
// google-sheets-cleaning.ts -- this module has no dependencies of its own beyond spreadsheet-reader.ts, so
// it's a safe, neutral home for both.)
//
// GENERALIZED (2026-09-24): a real, live-confirmed production gap -- a request phrased as "clean the
// selected Health source... apply one-record-per-domain cleanup, excluding large platform domains" reached
// google-sheets-cleaning.ts's processSelectedGoogleSheet() (the source-into-destination flow), which had
// never been wired to this collapse logic at all (only spreadsheet-existing-output-cleanup.ts's narrower,
// "Admin - Vendor"/"Client Sheet"-only flow had it). detectDomainLevelDedupIntent() below is the SAME
// detector both flows now call, so "one record per domain" is honored automatically regardless of which
// flow a real request reaches.

/**
 * Curated, explicit, general-knowledge list of well-known large platforms -- NOT derived from which domains
 * happened to repeat most in any one dataset (a real spam-scraped single site could also repeat hundreds of
 * times and would wrongly look "large" by that measure alone). Deliberately excludes anything not
 * confidently a well-known multi-tenant platform.
 *
 * ALWAYS-ON PROTECTION (2026-09-24): a real, live-confirmed gap -- this list previously only took effect
 * when a caller explicitly opted in (originally via chat phrase detection requiring the word
 * "exclude"/"excluding"). A real, live request phrased instead as "keep separate URLs for large platform
 * domains" -- a stated PERMANENT rule, not a one-off preference -- never matched that phrase, so platform
 * domains were silently subject to full collapse like any other domain (harmless only by chance, since none
 * of that particular run's real duplicate groups happened to be a platform domain). collapseDomainDuplicat
 * esToOnePerDomain() below now ALWAYS protects every domain on this list, unconditionally, with no opt-in
 * required -- see CollapseDomainDuplicatesOptions.additionalExcludedDomains for adding MORE exclusions on
 * top of this list; there is no way to turn OFF protection for a domain already on this list, since that
 * would defeat the "permanent rule" the user explicitly asked for.
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

// PRICING/DEAL-PROTECTION (2026-09-24): a real, live-confirmed compliance gap -- the domain-level collapse
// selection rule ("keep the lowest original row index") had NO awareness of pricing/deal data at all. A
// real, stated PERMANENT rule requires: a row that already carries deal/pricing data must NEVER be the one
// removed by domain-level collapse -- if exactly one member of a domain group is priced, THAT one must be
// kept regardless of row index; if two or more members are priced, the WHOLE group must be left alone (kept
// exactly as-is, flagged for manual review) rather than guessing which priced record is more "correct". This
// had no live-data trigger yet (the real run that surfaced this gap had zero priced source rows), but is a
// real, permanent-rule violation waiting to happen the first time it does. Shared with
// readWriteDestinationForDuplicateProtection()'s own pricing-column detection (google-sheets-cleaning.ts) so
// both mechanisms recognize the exact same set of real-world header spellings -- never two, potentially
// drifting definitions of "this column holds pricing/deal data".
export const PRICING_COLUMN_NAMES: readonly string[] = ["Admin Price", "Admin Prices", "Client Price", "Client Prices", "Profit", "Deal Status"];

function normalizeHeaderForPricingMatch(header: string): string {
  return header.trim().toLowerCase();
}

/** Real, exact (normalized) matches only against PRICING_COLUMN_NAMES -- never a substring/fuzzy guess. Preserves the sheet's OWN header casing/spelling in the returned list (never rewritten). */
export function detectPricingColumns(headers: readonly string[]): readonly string[] {
  const normalizedTargets = new Set(PRICING_COLUMN_NAMES.map(normalizeHeaderForPricingMatch));
  return headers.filter((header) => normalizedTargets.has(normalizeHeaderForPricingMatch(header)));
}

/** Same matching as detectPricingColumns(), returning column INDEXES instead of names -- what a row-level "is this row priced?" check actually needs. */
function detectPricingColumnIndexes(headers: readonly string[]): readonly number[] {
  const normalizedTargets = new Set(PRICING_COLUMN_NAMES.map(normalizeHeaderForPricingMatch));
  const indexes: number[] = [];
  headers.forEach((header, index) => {
    if (normalizedTargets.has(normalizeHeaderForPricingMatch(header))) indexes.push(index);
  });
  return indexes;
}

/** True when `row` has a real, non-blank value in ANY detected pricing/deal column -- never a guess about which specific column matters most. */
function isRowPriced(row: readonly string[], pricingColumnIndexes: readonly number[]): boolean {
  return pricingColumnIndexes.some((index) => (row[index] ?? "").trim() !== "");
}

export interface DomainDedupedCleaningResult {
  /** The result BEFORE this pass -- exact-duplicate removal only, domain groups still just flagged. Kept so callers/report builders can still show the real, full duplicate-group data. */
  readonly base: CleaningResult;
  /** The result AFTER this pass -- retainedRowIndexes/retainedRows/manualReviewRowIndexes reflect exactly one row kept per domain, on top of the existing exact-duplicate removal. */
  readonly result: CleaningResult;
  /** The one row per domain group that was kept (for reporting -- always already present in base.retainedRowIndexes; see this function's own proof in its implementation comment). */
  readonly domainDuplicateKeptRowIndexes: ReadonlySet<number>;
  /** Every other row in a domain group -- removed by this pass (a row already removed by exact-duplicate collapse may appear here too; removing it again is a safe no-op). RAW group membership -- do NOT sum this size with exactDuplicateGroups' own row count for a headline total, since the two sets can overlap. Use domainDuplicateAdditionalRemovedRowIndexes below for a reconciling total instead. */
  readonly domainDuplicateRemovedRowIndexes: ReadonlySet<number>;
  /** The subset of domainDuplicateRemovedRowIndexes that were STILL present in base.retainedRowIndexes (i.e. not already removed by exact-duplicate collapse) -- the TRUE incremental number of rows this pass removes on top of exact-duplicate removal. By construction, exactDuplicateGroups' own removed-row count + this set's size + result.retainedRowIndexes.length always equals base.originalRowCount exactly -- this is the set to use for any reconciling summary total. */
  readonly domainDuplicateAdditionalRemovedRowIndexes: ReadonlySet<number>;
  /** Domain groups that were deliberately left alone (not collapsed) because their normalized domain is a known large platform (always) or an additionalExcludedDomains entry -- still flagged, exactly like the default (no-collapse) mode, never removed. */
  readonly excludedDomainGroups: readonly DomainDuplicateGroup[];
  /** Domain groups left alone because TWO OR MORE members already carry real pricing/deal data -- "If both duplicates are protected deal/priced records, keep both for review," never auto-resolved by guessing which priced record is correct. Disjoint from excludedDomainGroups (a platform-excluded group is never also pricing-protected; it was never evaluated for pricing). */
  readonly pricingProtectedGroups: readonly DomainDuplicateGroup[];
}

export interface CollapseDomainDuplicatesOptions {
  /** Normalized domains (e.g. a specific non-platform site) to ALSO leave alone, on top of the always-on KNOWN_LARGE_PLATFORM_DOMAINS protection above -- their groups stay flagged-only, never collapsed. Case-insensitive; compared against the same normalizeDomain() output buildCleaningResult() already used to form the group. There is no option to disable KNOWN_LARGE_PLATFORM_DOMAINS protection itself. */
  readonly additionalExcludedDomains?: ReadonlySet<string>;
}

export function collapseDomainDuplicatesToOnePerDomain(base: CleaningResult, options?: CollapseDomainDuplicatesOptions): DomainDedupedCleaningResult {
  const excludedDomains = new Set([...KNOWN_LARGE_PLATFORM_DOMAINS, ...(options?.additionalExcludedDomains ?? [])]);
  const pricingColumnIndexes = detectPricingColumnIndexes(base.headers);
  // Pricing needs the row's REAL current values -- only rows still in base.retainedRowIndexes have them
  // available here (a row already removed by exact-duplicate collapse is, by definition, byte-identical
  // across every column -- including pricing -- to the sibling that WAS kept, so it needs no separate
  // lookup; the kept sibling's own priced-ness already represents it correctly).
  const retainedRowByIndex = new Map<number, readonly string[]>();
  base.retainedRowIndexes.forEach((rowIndex, position) => retainedRowByIndex.set(rowIndex, base.retainedRows[position]!));

  const domainDuplicateKeptRowIndexes = new Set<number>();
  const domainDuplicateRemovedRowIndexes = new Set<number>();
  const excludedDomainGroups: DomainDuplicateGroup[] = [];
  const pricingProtectedGroups: DomainDuplicateGroup[] = [];
  for (const group of base.domainDuplicateGroups) {
    if (excludedDomains.has(group.normalizedDomain)) {
      excludedDomainGroups.push(group);
      continue;
    }
    const sorted = [...group.rowIndexes].sort((a, b) => a - b);

    const pricedMembers = pricingColumnIndexes.length === 0 ? [] : sorted.filter((rowIndex) => {
      const row = retainedRowByIndex.get(rowIndex);
      return row ? isRowPriced(row, pricingColumnIndexes) : false;
    });

    if (pricedMembers.length >= 2) {
      // "If both duplicates are protected deal/priced records, keep both for review" -- never auto-resolved.
      pricingProtectedGroups.push(group);
      continue;
    }

    // Exactly one priced member: THAT row must be kept, regardless of its row index -- "If a duplicate has
    // one protected deal/priced record, remove only the other duplicate." Zero priced members: unchanged,
    // deterministic fallback to the lowest original row index (same convention exact-duplicate collapse
    // already uses).
    const keep = pricedMembers.length === 1 ? pricedMembers[0]! : sorted[0]!;
    const extras = sorted.filter((rowIndex) => rowIndex !== keep);
    // `keep` is always already present in base.retainedRowIndexes: when it's the lowest-index fallback, see
    // the proof this comment used to carry (it can't have been removed as an exact-duplicate extra, since
    // it's the lowest in its own superset too); when it's the priced member, it was only ever selected
    // because retainedRowByIndex (built FROM base.retainedRowIndexes) already had it.
    domainDuplicateKeptRowIndexes.add(keep);
    for (const rowIndex of extras) domainDuplicateRemovedRowIndexes.add(rowIndex);
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
  // Excluded domain groups and pricing-protected groups were deliberately left uncollapsed -- still
  // genuinely ambiguous (same domain, differing fields, or two competing priced records), so they stay
  // flagged for manual review exactly like the default (no-collapse) mode.
  for (const group of excludedDomainGroups) for (const i of group.rowIndexes) manualReviewSet.add(i);
  for (const group of pricingProtectedGroups) for (const i of group.rowIndexes) manualReviewSet.add(i);

  const result: CleaningResult = {
    ...base,
    retainedRowIndexes,
    retainedRows,
    manualReviewRowIndexes: Array.from(manualReviewSet).sort((a, b) => a - b),
  };

  return {
    base,
    result,
    domainDuplicateKeptRowIndexes,
    domainDuplicateRemovedRowIndexes,
    domainDuplicateAdditionalRemovedRowIndexes,
    excludedDomainGroups,
    pricingProtectedGroups,
  };
}

const FULLY_DEDUPED_AUDIT_CSV_COLUMNS = ["Category", "Original Row (data row #, header excluded)", "Matching Row(s)", "Duplicate Type", "Normalized Domain/URL", "Reason", "Proposed Action", "Final Disposition"];

/**
 * A real, reviewable CSV cleaning audit for the full-domain-dedup mode -- structurally mirrors
 * buildCleaningAuditCsv() above, but labels every non-canonical domain-duplicate row as REMOVED rather than
 * "flagged for review", matching what this mode's write-back actually does -- EXCEPT for a group whose
 * domain was excluded from collapsing (see collapseDomainDuplicatesToOnePerDomain's excludedDomains
 * option), which is reported as flagged-for-review, matching what actually happened to it (nothing
 * removed).
 */
export function buildFullyDedupedCleaningAuditCsv(base: CleaningResult, finalRetainedRowIndexes: ReadonlySet<number>, excludedDomains?: ReadonlySet<string>): string {
  const lines: string[] = [csvRow(FULLY_DEDUPED_AUDIT_CSV_COLUMNS)];

  for (const group of base.exactDuplicateGroups) {
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

  // TRUTH-DRIVEN DISPOSITION (2026-09-24): rather than re-deriving "was this group collapsed?" purely from
  // the excludedDomains parameter (which only knows about platform-domain exclusion, not the NEWER
  // pricing-protection case -- see collapseDomainDuplicatesToOnePerDomain()'s own header), this checks each
  // member's REAL final disposition against finalRetainedRowIndexes directly -- the actual source of truth
  // -- so a group left alone for EITHER reason (known platform domain, or two-or-more already-priced
  // members) is reported correctly without this function needing to know every possible protection reason.
  const domainFlaggedIndexes = new Set<number>();
  for (const group of base.domainDuplicateGroups) {
    const sorted = [...group.rowIndexes].sort((a, b) => a - b);
    const retainedMembers = sorted.filter((rowIndex) => finalRetainedRowIndexes.has(rowIndex));
    const removedMembers = sorted.filter((rowIndex) => !finalRetainedRowIndexes.has(rowIndex));

    if (removedMembers.length === 0) {
      // Every member of this group survived -- either a known-platform-domain exclusion or a
      // pricing-protection "keep both for review" case. excludedDomains is the one distinguishing signal
      // available here; anything not on it that still wasn't collapsed is the pricing-protected case.
      const isPlatformExcluded = excludedDomains?.has(group.normalizedDomain) ?? false;
      for (const rowIndex of sorted) {
        domainFlaggedIndexes.add(rowIndex);
        lines.push(
          csvRow([
            "B_DOMAIN_DUPLICATE_FLAGGED",
            String(rowIndex + 1),
            sorted.filter((i) => i !== rowIndex).map((i) => i + 1).join(";"),
            "Domain/URL duplicate",
            group.normalizedDomain,
            isPlatformExcluded
              ? "Excluded from domain-level collapsing (known large platform domain) -- other fields differ."
              : "Two or more records for this domain already carry real pricing/deal data -- kept both, never auto-resolved.",
            "Keep -- review manually",
            "Retained (flagged for review)",
          ]),
        );
      }
      continue;
    }

    // Normal collapse: exactly one retained member (kept by the lowest-row-index rule, or because it was
    // the group's one priced record -- either way, the real, current source of truth), the rest removed.
    const keptIndex = retainedMembers[0]!;
    for (const rowIndex of removedMembers) {
      lines.push(
        csvRow([
          "B_DOMAIN_DUPLICATE_REMOVED",
          String(rowIndex + 1),
          String(keptIndex + 1),
          "Domain/URL duplicate",
          group.normalizedDomain,
          `Same normalized domain as data row ${keptIndex + 1} -- kept exactly one record per domain.`,
          "Remove -- one unique record per domain retained",
          "Removed",
        ]),
      );
    }
  }

  const flaggedIndexes = new Set([...base.malformedUrlRows.map((f) => f.rowIndex), ...base.incompleteRows.map((f) => f.rowIndex), ...domainFlaggedIndexes]);
  for (const flag of base.malformedUrlRows) {
    lines.push(
      csvRow([
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
      csvRow([
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
      lines.push(csvRow(["D_VALID_RETAINED", String(rowIndex + 1), "", "", "", "No issues detected.", "Keep", "Retained"]));
    }
  }

  return lines.join("");
}

const DOMAIN_LEVEL_DEDUP_PHRASES = /\bper[\s-]+(website|domain)\b|\bone[\s-]+(unique[\s-]+)?record[\s-]+per\b|\bone[\s-]+(unique[\s-]+)?row[\s-]+per\b/i;
// PLATFORM-EXCLUSION PHRASING: a real, explicit request to leave known large multi-tenant platform domains
// (KNOWN_LARGE_PLATFORM_DOMAINS above) OUT of the domain-level collapse. Mentioning platform exclusion only
// makes sense together with domain-level collapse, so matching this phrase ALSO implies dedupeByDomain in
// detectDomainLevelDedupIntent() below.
const PLATFORM_EXCLUSION_PHRASES = /\bexclud(e|ing)\b[^.?!]{0,60}\bplatform/i;
// PERMANENT-RULES REFERENCE FIX (2026-09-15): a real, live-confirmed gap -- once the domain-level collapse
// + platform-exclusion + pricing-protection behavior became the established "permanent duplicate-cleaning
// rules" (see this module's own KNOWN_LARGE_PLATFORM_DOMAINS/PRICING_COLUMN_NAMES headers), every real
// live chat invocation stopped re-stating "one record per domain" literally and instead just referenced
// the rules by name -- "Clean the selected Health Sheet using the permanent duplicate-cleaning rules." --
// exactly the standard, PDF-documented phrasing this project's own live tests now always use. That phrase
// matches neither DOMAIN_LEVEL_DEDUP_PHRASES nor PLATFORM_EXCLUSION_PHRASES above, so dedupeByDomain
// silently stayed false and every request through this exact, now-canonical wording fell back to
// flag-only behavior (49 rows flagged, 0 collapsed) -- never actually applying the "permanent" rules it
// named. Deliberately bounded ("permanent" within 60 chars of "rule(s)") so it stays a real, specific
// signal rather than matching any unrelated mention of either word alone.
const PERMANENT_RULES_PHRASES = /\bpermanent\b[^.?!]{0,60}\brules?\b|\brules?\b[^.?!]{0,60}\bpermanent\b/i;

export interface DomainLevelDedupIntent {
  /** true when the message explicitly asks for one record per domain/website -- see DOMAIN_LEVEL_DEDUP_PHRASES above. Also true whenever excludePlatformDomains is true. */
  readonly dedupeByDomain: boolean;
  /** true when the message explicitly asks to exclude known large platform domains from the domain-level collapse -- see PLATFORM_EXCLUSION_PHRASES above. Only has any effect when dedupeByDomain is also true, which this always forces true when set. */
  readonly excludePlatformDomains: boolean;
}

/**
 * REGRESSION-TESTED FIX (2026-09-24): the original version of these phrases required literal whitespace
 * between words (\s+), so a real, live-confirmed request phrased as "one-record-per-domain" (hyphenated,
 * exactly as a real user wrote it) never matched -- \s+ does not match a hyphen. Now tolerant of either
 * separator ([\s-]+) throughout, so both "one record per domain" and "one-record-per-domain" match
 * identically.
 */
export function detectDomainLevelDedupIntent(message: string): DomainLevelDedupIntent {
  const excludePlatformDomains = PLATFORM_EXCLUSION_PHRASES.test(message);
  const dedupeByDomain = excludePlatformDomains || DOMAIN_LEVEL_DEDUP_PHRASES.test(message) || PERMANENT_RULES_PHRASES.test(message);
  return { dedupeByDomain, excludePlatformDomains };
}
