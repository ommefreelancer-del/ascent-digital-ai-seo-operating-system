// FINAL BUSINESS OUTPUT SCHEMA (2026-09-03, revised 2026-09-03: two-URL schema, DR removed, Traffic
// renamed "Organic Traffic"): maps a cleaned prospect sheet's real, arbitrary SOURCE columns (whatever
// the uploaded workbook actually calls them) into the fixed, 17-column business schema the Google Sheets
// write-back (and the reviewable cleaned artifact) must always use, regardless of the source file's own
// header names. Deliberately a SEPARATE, later transformation from the cleaning logic itself
// (spreadsheet-cleaning.ts) -- exact-duplicate/domain-duplicate/malformed/incomplete detection all
// continue to operate on the ORIGINAL source columns and are completely unaffected by this file; this
// only reshapes the ALREADY-CLEANED, retained rows for the final deliverable.
//
// NEVER FABRICATES A VALUE: a target column is populated only when a genuinely equivalent source column
// is found by exact (normalized) header match -- never a substring/fuzzy guess, and never by repurposing
// an unrelated metric (e.g. Ahrefs' own "AR" / Ahrefs Rank is a different metric from Moz's "DA"/"PA",
// and "DR" / Domain Rating is intentionally NOT a final business column at all per the latest business
// requirement -- neither is in any alias list below). A target column with no verified source match is
// left as an empty string for every row, exactly matching the "leave empty, never guess" requirement --
// this is a real business decision, not an oversight.

/** The exact, fixed, 17-column order the business requires -- never reordered, never extended, never reduced. Two URL columns (Clean first, Original second) replace the previous single "URL" column; "DR" was removed entirely (not a final business column); "Traffic" was renamed "Organic Traffic". */
export const FINAL_BUSINESS_SCHEMA_COLUMNS = [
  "Clean URL",
  "Original URL",
  "DA",
  "PA",
  "SS",
  "Organic Traffic",
  "Email",
  "Category",
  "Journal / Website Type",
  "Contact Email",
  "Contact Name",
  "Domain Age",
  "Admin Price",
  "Client Price",
  "Profit",
  "Deal Status",
  "Notes",
] as const;

export type FinalBusinessSchemaColumn = (typeof FINAL_BUSINESS_SCHEMA_COLUMNS)[number];

// ---------------------------------------------------------------------------------------------------
// PRESENTATION LAYOUT (2026-09-03): a real, live-confirmed visual defect -- an unusually long Original
// URL (a full page path/query string) could still exceed the writer's generic auto-width cap and visually
// spill into neighboring DA/PA/SS/Organic Traffic columns. Fixed by giving the two URL columns explicit
// fixed widths (Clean URL stays short -- a domain root is always short; Original URL is wider) and
// enabling wrap-text on Original URL's data cells, so a long value wraps onto multiple lines WITHIN its
// own cell instead of ever overflowing horizontally. This is presentation-only -- it changes neither the
// column set/order, the mapping logic, nor the traffic split above.
// ---------------------------------------------------------------------------------------------------

const CLEAN_URL_COLUMN_WIDTH = 32;
const ORIGINAL_URL_COLUMN_WIDTH = 60;

/** Explicit column-width overrides for xlsx-writer.ts's buildXlsxWorkbook(), keyed by FINAL_BUSINESS_SCHEMA_COLUMNS' own index order -- every other column is `undefined` and falls back to xlsx-writer's generic content-derived auto-width. */
export const BUSINESS_SCHEMA_COLUMN_WIDTHS: readonly (number | undefined)[] = FINAL_BUSINESS_SCHEMA_COLUMNS.map((column) => {
  if (column === "Clean URL") return CLEAN_URL_COLUMN_WIDTH;
  if (column === "Original URL") return ORIGINAL_URL_COLUMN_WIDTH;
  return undefined;
});

/** Column indexes (into FINAL_BUSINESS_SCHEMA_COLUMNS) whose DATA cells get wrap-text alignment in the generated XLSX -- only "Original URL", since Clean URL is always short and every other column's values are short verified metrics/text. */
export const BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS: readonly number[] = [FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL")];

/**
 * Real, genuinely-equivalent source header ALIASES for every target column EXCEPT "Original URL"/
 * "Clean URL" (both resolved separately, from the SAME urlColumnIndex the cleaning logic itself already
 * computed -- reusing that one authoritative answer rather than a second, possibly-inconsistent
 * heuristic). "DR" is deliberately ABSENT -- it is intentionally not a final business column per the
 * latest business requirement, regardless of whether a real "Domain Rating" source column exists.
 *
 * Matching handles the real "Metric Name (ABBREV)" header format (e.g. "Domain Rating (DR)", "Domain
 * Search Traffic (ST)") via matchesAlias() below: exact match, OR the header starts with `"${alias} ("`.
 * "Organic Traffic" is matched most-specific-first: "Domain Search Traffic"/"Domain Organic Traffic"
 * (site-wide) are recognized; "Page Search Traffic"/"Page Organic Traffic" are DELIBERATELY ABSENT -- a
 * real workbook can carry both as genuinely different Ahrefs metrics (site-wide vs. single-page), and
 * this must never conflate them.
 */
const SCHEMA_HEADER_ALIASES: Readonly<Partial<Record<FinalBusinessSchemaColumn, readonly string[]>>> = {
  DA: ["domain authority", "da"],
  PA: ["page authority", "pa"],
  SS: ["spam score", "ss"],
  "Organic Traffic": ["domain organic traffic", "domain search traffic", "organic traffic", "search traffic", "traffic", "est. traffic", "est traffic", "estimated traffic"],
  Email: ["email"],
  Category: ["category", "niche"],
  "Journal / Website Type": ["journal", "journal / website type", "journal/website type", "website type", "site type"],
  "Contact Email": ["contact email"],
  "Contact Name": ["contact name", "contact"],
  "Domain Age": ["domain age"],
  "Admin Price": ["admin price"],
  "Client Price": ["client price"],
  Profit: ["profit"],
  "Deal Status": ["deal status"],
  Notes: ["notes", "note"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A normalized header matches an alias when it's EXACTLY equal, or starts with `"${alias} ("` -- the real "Metric Name (ABBREV)" format (e.g. "domain rating (dr)" matches alias "domain rating"). Never a bare substring/contains match -- "domain search traffic value" does NOT match alias "domain search traffic" (continues with " value", not " ("), so a genuinely different metric can never be silently absorbed. */
function matchesAlias(normalizedHeader: string, alias: string): boolean {
  return normalizedHeader === alias || normalizedHeader.startsWith(`${alias} (`);
}

/**
 * True when a data row is an embedded header/section-divider row -- never a genuine prospect record.
 * Catches TWO real, live-confirmed variants: (1) an EXACT duplicate of the header row (every cell
 * matches), and (2) a SECTION-DIVIDER row from a real multi-section export, where column 0 holds a row
 * number, a placeholder, or a category/section label (e.g. "x", "Email Marketing Tools") but every OTHER
 * column repeats the literal header text verbatim (e.g. its own "URL" cell literally reads "URL", its own
 * "Domain Search Traffic (ST)" cell literally reads "Domain Search Traffic (ST)"). Column 0 is
 * deliberately never compared for a 2+-column sheet -- a genuine prospect record can never coincidentally
 * repeat 16+ header labels verbatim across every other metric column, so this is a safe, precise signal
 * regardless of what column 0 itself contains. For a single-column sheet, falls back to a full exact match
 * (skipping the only column would trivially match every row).
 */
function isEmbeddedHeaderRow(sourceRow: readonly string[], normalizedSourceHeaders: readonly string[]): boolean {
  if (sourceRow.length !== normalizedSourceHeaders.length) return false;
  const compareFromIndex = normalizedSourceHeaders.length > 1 ? 1 : 0;
  for (let index = compareFromIndex; index < normalizedSourceHeaders.length; index++) {
    if (normalizeHeader(sourceRow[index] ?? "") !== normalizedSourceHeaders[index]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// URL RULE: Clean URL (domain-level root, derived) + Original URL (preserved exactly), side by side.
// ---------------------------------------------------------------------------------------------------

/**
 * A bare digit-only string (e.g. "3", "6887") is never a real domain -- but the WHATWG URL parser
 * (real, live-confirmed defect: a genuine source row's malformed URL cell was the literal value "3")
 * treats an all-numeric host as a 32-bit IPv4 address and silently CANONICALIZES it into dotted-decimal
 * notation (`new URL("https://3").hostname === "0.0.0.3"`), which would otherwise invent a fake,
 * meaningless IP-address "domain" out of garbage data. Detected on the raw host candidate BEFORE
 * constructing the URL (an already-dotted numeric host the source genuinely typed, e.g. "192.168.1.1", is
 * unaffected and still normalizes normally).
 */
function isBareNumericHost(hostCandidate: string): boolean {
  return /^\d+$/.test(hostCandidate);
}

/**
 * Deterministic Clean URL derivation: the DOMAIN-LEVEL ROOT URL, never a normalized copy of the specific
 * page URL (Original URL already preserves the real page URL exactly -- that is what Clean URL must never
 * duplicate or overwrite). Ensures an explicit scheme (defaults to https:// ONLY when the source specified
 * none at all -- an explicit http:// is left as http://, never force-upgraded, since that could point at a
 * genuinely different endpoint), lowercases the host, keeps a real non-default port when present, and
 * DROPS the path, query string, and fragment entirely -- e.g.
 * "https://instatus.com/blog/write-for-us" -> "https://instatus.com/". A value that cannot be parsed as a
 * URL at all, OR whose host is a bare number (see isBareNumericHost() above -- never a real domain), is
 * returned UNCHANGED (honest fallback, never invents a different domain).
 */
export function deriveCleanRootUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  const hostCandidate = (hasScheme ? trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "") : trimmed).split(/[/?#]/)[0]!.split("@").pop()!.split(":")[0]!;
  if (isBareNumericHost(hostCandidate)) return rawUrl;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return rawUrl;
  }
  const host = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}/`;
}

export interface FinalBusinessSchemaResult {
  readonly headers: readonly FinalBusinessSchemaColumn[];
  readonly rows: readonly (readonly string[])[];
  /** Exactly which target columns found a real, verified source match -- everything else in FINAL_BUSINESS_SCHEMA_COLUMNS was intentionally left empty because no verified source column exists. */
  readonly mappedColumns: ReadonlySet<FinalBusinessSchemaColumn>;
}

/**
 * Reshapes already-cleaned (retained) rows from their real source columns into the fixed 17-column
 * business schema. `urlColumnIndex` is the SAME real, already-detected URL/domain column index the
 * cleaning result itself carries (spreadsheet-cleaning.ts's detectUrlColumnIndex()) -- reused here, never
 * re-derived, so both "Clean URL" and "Original URL" always derive from exactly what the cleaning logic
 * itself treated as the prospect's own URL/domain. "Clean URL" is deriveCleanRootUrl() applied to the raw
 * value (the domain-level root only); "Original URL" is that SAME raw source value, byte for byte -- Clean
 * URL is never used to overwrite Original URL, and the two are always adjacent columns (Clean URL first)
 * so a reviewer can compare them.
 */
export function mapToFinalBusinessSchema(sourceHeaders: readonly string[], sourceRows: readonly (readonly string[])[], urlColumnIndex: number | null): FinalBusinessSchemaResult {
  const normalizedSourceHeaders = sourceHeaders.map(normalizeHeader);
  const sourceIndexForTarget = new Map<FinalBusinessSchemaColumn, number>();

  for (const target of FINAL_BUSINESS_SCHEMA_COLUMNS) {
    if (target === "Clean URL" || target === "Original URL") continue;
    const aliases = SCHEMA_HEADER_ALIASES[target];
    if (!aliases) continue;
    // PRIORITY-ORDERED alias matching (2026-09-03): tries each alias in its DECLARED order against every
    // source header, rather than scanning source headers left-to-right -- matters specifically for
    // "Organic Traffic", where a source workbook could plausibly carry BOTH an unambiguous "Domain
    // Search Traffic" column and a differently-scoped one (e.g. "Page Search Traffic" -- a genuinely
    // different Ahrefs metric this must never conflate). Trying the most specific alias first means a
    // real "Domain Search Traffic" column always wins over a same-workbook coincidence, rather than
    // whichever happens to appear first in the file's own column order.
    let matchIndex = -1;
    for (const alias of aliases) {
      matchIndex = normalizedSourceHeaders.findIndex((header) => matchesAlias(header, alias));
      if (matchIndex !== -1) break;
    }
    if (matchIndex !== -1) sourceIndexForTarget.set(target, matchIndex);
  }

  // EMBEDDED HEADER ROW REMOVAL (2026-09-03): a real, live-confirmed defect -- a multi-section export
  // (common in Ahrefs-style tools) can carry the literal header row repeated again somewhere in the
  // middle of the data. Exact-duplicate detection (spreadsheet-cleaning.ts) never catches this because it
  // only compares data rows against EACH OTHER, never against the header row itself, so this bogus
  // "record" survived cleaning and was retained. Removed here, at the final-output stage, rather than in
  // the validated cleaning logic -- it is not a real prospect record, so dropping it loses no genuine
  // data; it is filtered out of the reshaped rows before the business-schema mapping is applied.
  const dataRows = sourceRows.filter((sourceRow) => !isEmbeddedHeaderRow(sourceRow, normalizedSourceHeaders));

  const rows = dataRows.map((sourceRow) => {
    const rawUrl = urlColumnIndex !== null ? (sourceRow[urlColumnIndex] ?? "") : "";
    return FINAL_BUSINESS_SCHEMA_COLUMNS.map((target) => {
      if (target === "Clean URL") return urlColumnIndex !== null ? deriveCleanRootUrl(rawUrl) : "";
      if (target === "Original URL") return rawUrl;
      const sourceIndex = sourceIndexForTarget.get(target);
      return sourceIndex === undefined ? "" : (sourceRow[sourceIndex] ?? "");
    });
  });

  if (urlColumnIndex !== null) {
    sourceIndexForTarget.set("Clean URL", urlColumnIndex);
    sourceIndexForTarget.set("Original URL", urlColumnIndex);
  }

  return {
    headers: FINAL_BUSINESS_SCHEMA_COLUMNS,
    rows,
    mappedColumns: new Set(sourceIndexForTarget.keys()),
  };
}

// ---------------------------------------------------------------------------------------------------
// TRAFFIC-BASED SHEET SPLIT (2026-09-03): a real business rule -- retained, schema-mapped websites are
// routed to exactly one of two destinations (Admin/Vendor vs. Client Websites) by their VERIFIED organic
// traffic value. This is a WRITE/ARTIFACT-time concern only -- it never touches cleaning, duplicate
// detection, or the schema mapping above; it operates purely on an already-mapped FinalBusinessSchemaResult.
// ---------------------------------------------------------------------------------------------------

/** >= this value routes to Admin/Vendor; below routes to Client Websites. Applied to the raw, unrounded numeric organic-traffic value -- never the rounded/K-M-formatted display string. */
export const TRAFFIC_SPLIT_THRESHOLD = 1000;

/** Fixed destination sheet/tab names -- both written within the SAME connected spreadsheet (no second
 * spreadsheet-selection mechanism invented). CLIENT_WEBSITES_SHEET_NAME's real VALUE is "Client Sheet" --
 * the user's exact intended destination name for the <1,000-traffic tab (2026-09-15); the constant keeps
 * its established name across the codebase to avoid an unrelated, purely-cosmetic rename of every
 * reference to it. */
export const ADMIN_VENDOR_SHEET_NAME = "Admin - Vendor";
export const CLIENT_WEBSITES_SHEET_NAME = "Client Sheet";

/** Real, deterministic numeric parse of a raw organic-traffic cell value -- strips thousands separators/whitespace only; never guesses at a non-numeric or missing value (returns null, honestly, rather than defaulting to 0). */
function parseNumericTraffic(rawValue: string): number | null {
  const cleaned = rawValue.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Real, deterministic DISPLAY formatting for the Organic Traffic column:
 *   < 1,000            -> the actual number, unrounded (e.g. "900")
 *   1,000 - 999,999     -> K notation, at most one decimal place (e.g. "2.5K", "25K", "850K", "1K")
 *   1,000,000+          -> M notation, at most one decimal place (e.g. "1M", "2.5M", "12.5M")
 * A raw value that isn't a genuine, verified number (missing/unparseable) is returned UNCHANGED --
 * never coerced into "0" or any other invented number.
 */
export function formatTrafficDisplay(rawValue: string): string {
  const numeric = parseNumericTraffic(rawValue);
  if (numeric === null) return rawValue;
  if (numeric < 1_000) return String(numeric);
  if (numeric < 1_000_000) return formatWithSuffix(numeric, 1_000, "K");
  return formatWithSuffix(numeric, 1_000_000, "M");
}

function formatWithSuffix(value: number, unit: number, suffix: string): string {
  const scaled = value / unit;
  const rounded = Math.round(scaled * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}${suffix}`;
}

export interface TrafficSplitResult {
  readonly adminVendor: FinalBusinessSchemaResult;
  readonly clientWebsites: FinalBusinessSchemaResult;
}

/**
 * Splits an already schema-mapped dataset into the two required destinations by VERIFIED organic
 * traffic -- every row lands in EXACTLY one destination (never both, never dropped): >= 1000 to
 * Admin/Vendor, everything else (< 1000, OR genuinely unverified/unparseable traffic, which can never be
 * assumed to qualify as high-traffic) to Client Websites. The OUTPUT Organic Traffic cell is reformatted
 * for display (K/M notation) at this same step -- the SPLIT DECISION itself always uses the raw,
 * unrounded numeric value computed independently of that display formatting.
 */
export function splitByOrganicTraffic(schema: FinalBusinessSchemaResult): TrafficSplitResult {
  const trafficIndex = schema.headers.indexOf("Organic Traffic");
  const adminVendorRows: string[][] = [];
  const clientWebsiteRows: string[][] = [];

  for (const row of schema.rows) {
    const rawTraffic = row[trafficIndex] ?? "";
    const numericTraffic = parseNumericTraffic(rawTraffic);
    const displayRow = row.slice();
    displayRow[trafficIndex] = formatTrafficDisplay(rawTraffic);

    if (numericTraffic !== null && numericTraffic >= TRAFFIC_SPLIT_THRESHOLD) {
      adminVendorRows.push(displayRow);
    } else {
      clientWebsiteRows.push(displayRow);
    }
  }

  return {
    adminVendor: { headers: schema.headers, rows: adminVendorRows, mappedColumns: schema.mappedColumns },
    clientWebsites: { headers: schema.headers, rows: clientWebsiteRows, mappedColumns: schema.mappedColumns },
  };
}
