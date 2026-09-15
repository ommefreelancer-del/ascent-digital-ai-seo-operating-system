// DESTINATION-PROTECTION DUPLICATE RESOLUTION (2026-09-18): a real, live-confirmed production defect --
// readWriteDestinationForDuplicateProtection() (google-sheets-cleaning.ts, 2026-09-16) already read the
// configured write destination's existing content read-only and reported it in the chat proposal, but
// NOTHING in the pipeline actually consulted that data when deciding which incoming Health Master records
// to include in the write -- see that function's own prior header: "not yet applied in this proposal".
// A live proposal generated after explicitly requesting destination protection still showed only the
// generic Health-Master-internal cleaning stats (retained/exact-duplicate/domain-duplicate/manual-review
// counts) -- the existing destination baseline was read and reported, but never used as the protected
// baseline it was supposed to be.
//
// This module is the missing consumer: given the incoming, already schema-mapped Health Master records
// (FinalBusinessSchemaResult -- the SAME 17-column shape splitByOrganicTraffic() already operates on) and
// the destination's own existing content (DestinationReadOutcome, status "ok"), it decides -- by REAL,
// normalized-website matching against the destination's own URL column, never a guess -- which incoming
// records are safe to write and which must be held back:
//
//   - destination has this website AND it's priced/deal-done there -> the incoming duplicate is OMITTED
//     (never written); the existing destination record is untouched (this module never returns or
//     references destination rows for removal -- it only reads them to decide about INCOMING rows).
//   - destination has this website, priced there, AND the incoming record is ALSO priced -> neither is
//     auto-resolved; the incoming record is held back and FLAGGED for manual review (never silently
//     dropped, never silently written over the existing priced record).
//   - destination has this website but it's genuinely unpriced there, OR the destination has no matching
//     website at all -> no special protection applies; the incoming record proceeds through the ordinary
//     Health-Master-internal duplicate rules already computed upstream (buildCleaningResult()), completely
//     unaffected by this module.
//
// The real, physical "never overwrite the destination" guarantee comes from a DIFFERENT, already-true fact
// this module does not need to enforce itself: the only write path (spreadsheet-google-sheets-writeback.ts)
// calls appendSpreadsheetValues() exclusively -- there is no clear/update/replace call anywhere in that
// path, so the destination's own existing rows are structurally untouched by any real write regardless of
// what this module decides. This module's job is narrower and complementary: deciding which INCOMING rows
// are even eligible to be appended in the first place.

import { detectUrlColumnIndex, normalizeDomain } from "./spreadsheet-cleaning";
import { FINAL_BUSINESS_SCHEMA_COLUMNS, type FinalBusinessSchemaResult, type FinalBusinessSchemaColumn } from "./spreadsheet-business-schema";
import type { DestinationReadOutcome } from "./google-sheets-cleaning";

const ORIGINAL_URL_INDEX = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL" as FinalBusinessSchemaColumn);
const CLEAN_URL_INDEX = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL" as FinalBusinessSchemaColumn);
const PRICE_COLUMNS: readonly FinalBusinessSchemaColumn[] = ["Admin Price", "Client Price", "Deal Status"];
const PRICE_COLUMN_INDEXES = PRICE_COLUMNS.map((c) => FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf(c));

export interface DestinationProtectionResult {
  /** Whether destination protection could actually be applied -- false when the destination has no
   * detectable URL/domain column at all (never a guess at which column to match on). */
  readonly applied: boolean;
  /** Incoming rows safe to write -- neither protected-omitted nor flagged, same shape as the input schema's rows. */
  readonly eligibleRows: readonly (readonly string[])[];
  /** Incoming rows that duplicate an existing PRICED destination record and were held back entirely --
   * never written, and the existing destination record is left completely untouched. */
  readonly protectedOmittedRows: readonly (readonly string[])[];
  /** Incoming rows where BOTH the existing destination record and the incoming record are priced -- held
   * back and flagged for manual review; neither auto-included nor auto-deleted. */
  readonly flaggedForManualReviewRows: readonly (readonly string[])[];
  /** How many distinct normalized websites in the destination were detected as priced/protected. */
  readonly protectedDestinationWebsiteCount: number;
}

function hasAnyPrice(row: readonly string[]): boolean {
  return PRICE_COLUMN_INDEXES.some((index) => (row[index] ?? "").trim() !== "");
}

function incomingNormalizedWebsite(row: readonly string[]): string | null {
  const original = row[ORIGINAL_URL_INDEX] ?? "";
  const clean = row[CLEAN_URL_INDEX] ?? "";
  return normalizeDomain(original) ?? normalizeDomain(clean);
}

/**
 * Builds the set of normalized websites that are priced/deal-done in the destination's existing content --
 * real, exact (normalized-domain) matches only, using the destination's own detected URL column and the
 * already-detected pricing columns (DestinationReadOutcome's own pricingColumnsDetected). Returns an empty
 * set (never a guess) when the destination has no detectable URL column.
 */
function buildProtectedWebsiteSet(destination: Extract<DestinationReadOutcome, { status: "ok" }>): { protectedWebsites: ReadonlySet<string>; applied: boolean } {
  const destinationUrlColumnIndex = detectUrlColumnIndex(destination.headers);
  if (destinationUrlColumnIndex === null) {
    return { protectedWebsites: new Set(), applied: false };
  }
  const pricingColumnIndexes = destination.pricingColumnsDetected.map((name) => destination.headers.indexOf(name)).filter((index) => index !== -1);

  const protectedWebsites = new Set<string>();
  for (const row of destination.rows) {
    if (pricingColumnIndexes.length === 0) continue;
    const rowHasPrice = pricingColumnIndexes.some((index) => (row[index] ?? "").trim() !== "");
    if (!rowHasPrice) continue;
    const normalized = normalizeDomain(row[destinationUrlColumnIndex] ?? "");
    if (normalized) protectedWebsites.add(normalized);
  }
  return { protectedWebsites, applied: true };
}

/**
 * The one, real duplicate-resolution step that actually consults the destination's existing content -- see
 * this file's own header for the full decision rules. `destination` must already be a successful read
 * (status "ok"); callers with "not_configured"/"read_failed" should skip calling this entirely (nothing to
 * protect against, or the destination's real content is genuinely unknown -- never fabricated).
 */
export function applyDestinationProtection(schema: FinalBusinessSchemaResult, destination: Extract<DestinationReadOutcome, { status: "ok" }>): DestinationProtectionResult {
  const { protectedWebsites, applied } = buildProtectedWebsiteSet(destination);

  if (!applied) {
    return { applied: false, eligibleRows: schema.rows, protectedOmittedRows: [], flaggedForManualReviewRows: [], protectedDestinationWebsiteCount: 0 };
  }

  const eligibleRows: (readonly string[])[] = [];
  const protectedOmittedRows: (readonly string[])[] = [];
  const flaggedForManualReviewRows: (readonly string[])[] = [];

  for (const row of schema.rows) {
    const website = incomingNormalizedWebsite(row);
    const isProtectedMatch = website !== null && protectedWebsites.has(website);
    if (!isProtectedMatch) {
      eligibleRows.push(row);
      continue;
    }
    if (hasAnyPrice(row)) {
      flaggedForManualReviewRows.push(row);
    } else {
      protectedOmittedRows.push(row);
    }
  }

  return { applied: true, eligibleRows, protectedOmittedRows, flaggedForManualReviewRows, protectedDestinationWebsiteCount: protectedWebsites.size };
}
