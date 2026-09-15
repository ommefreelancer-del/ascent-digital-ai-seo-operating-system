// ROW COLUMN-OFFSET REALIGNMENT (2026-09-15): real regression coverage for a live-confirmed production
// defect -- a real Health Master Sheet cleaning run (5,786 source rows) produced an Admin/Vendor + Client
// Sheet split where 3,755 of 5,222 retained records (72%) had "Organic Traffic" populated but "Clean
// URL"/"Original URL" blank, and the write-back counts (3,888 / 1,334) did not reflect genuine
// <1,000-vs->=1,000 traffic classification. Root cause, confirmed by reproducing it against the actual
// persisted CleaningResult snapshot (read-only DB inspection, no live Sheets/paid API calls): a later
// section of the real source sheet was pasted 3 columns to the right of the header's own column A, so
// Google Sheets' values.get returned those rows 3 cells longer than the header, with every real field
// silently sitting 3 positions later than every header-derived fixed column index (urlColumnIndex, the
// Organic Traffic alias's source index, ...) assumed. See spreadsheet-cleaning.ts's own
// realignColumnShiftedRow() header for the full mechanism.
//
// These tests build small, synthetic datasets that reproduce the SAME structural defect (not the real
// Health Master Sheet's actual rows, which are real user data) -- deterministic, pure functions only, zero
// DB/filesystem/network access, zero live or paid API calls.

import { describe, expect, it } from "vitest";
import { buildCleaningResult, realignColumnShiftedRow } from "@/server/backend/spreadsheet-cleaning";
import { mapToFinalBusinessSchema, splitByOrganicTraffic, TRAFFIC_SPLIT_THRESHOLD, CLIENT_WEBSITES_SHEET_NAME, ADMIN_VENDOR_SHEET_NAME } from "@/server/backend/spreadsheet-business-schema";

const HEADERS = ["#", "Search query", "URL", "Domain Rating (DR)", "Ahrefs Rank (AR)", "Domain Referring Pages (RP)", "Domain Search Traffic (ST)"];

/** Builds a REAL 7-column row (matching HEADERS above) for one prospect record. */
function realRow(n: string, url: string, dr: string, ar: string, rp: string, traffic: string): string[] {
  return [n, "query", url, dr, ar, rp, traffic];
}

/** Shifts a real row N columns to the right by prepending N genuinely-empty cells -- exactly what Google
 * Sheets' values.get returns for a row whose real data starts N columns after column A in the actual
 * sheet. */
function shiftRight(row: readonly string[], n: number): string[] {
  return [...Array(n).fill(""), ...row];
}

describe("realignColumnShiftedRow -- the core fix", () => {
  it("leaves an already-correctly-aligned row (length === header length) completely unchanged", () => {
    const row = realRow("1", "https://example.com", "50", "1000", "20", "5000");
    expect(realignColumnShiftedRow(row, HEADERS.length)).toEqual(row);
  });

  it("strips exactly N genuinely-empty leading cells when the row is N columns longer than the header", () => {
    const row = realRow("1", "https://example.com", "50", "1000", "20", "5000");
    const shifted = shiftRight(row, 3);
    expect(shifted).toHaveLength(10);
    expect(realignColumnShiftedRow(shifted, HEADERS.length)).toEqual(row);
  });

  it("never strips a leading cell that has real content -- a longer row for a different reason is left completely unchanged, never guessed", () => {
    const row = ["not-blank", "", "", ...realRow("1", "https://example.com", "50", "1000", "20", "5000")];
    expect(realignColumnShiftedRow(row, HEADERS.length)).toEqual(row);
  });

  it("leaves a row SHORTER than the header untouched -- a genuinely-missing-trailing-columns row is a different, already-correctly-handled case", () => {
    const row = ["1", "query", "https://example.com"];
    expect(realignColumnShiftedRow(row, HEADERS.length)).toEqual(row);
  });

  it("handles a zero-shift (row already exactly header length) as a no-op even when called explicitly", () => {
    const row = realRow("1", "https://example.com", "50", "1000", "20", "5000");
    expect(realignColumnShiftedRow(row, row.length)).toEqual(row);
  });
});

describe("buildCleaningResult -- realignment runs before every downstream consumer sees the rows", () => {
  it("a shifted row's URL is correctly detected -- never flagged incomplete/malformed just because of the offset", () => {
    const shiftedRow = shiftRight(realRow("1", "https://good-domain.com", "50", "1000", "20", "5000"), 3);
    const result = buildCleaningResult(HEADERS, [shiftedRow]);
    expect(result.incompleteRows).toEqual([]);
    expect(result.malformedUrlRows).toEqual([]);
    expect(result.retainedRows[0]).toEqual(realRow("1", "https://good-domain.com", "50", "1000", "20", "5000"));
  });

  it("a shifted repeated-header/section-divider row is correctly recognized and excluded from the final business-schema output (previously survived as a bogus record because its length never matched the primary header)", () => {
    const dividerRow = shiftRight(HEADERS, 3);
    const realDataRow = shiftRight(realRow("1", "https://example.com", "50", "1000", "20", "5000"), 3);
    const result = buildCleaningResult(HEADERS, [dividerRow, realDataRow]);
    // Realigned, the divider row now exactly matches HEADERS.length AND repeats the header text --
    // buildCleaningResult itself does not filter it (that's mapToFinalBusinessSchema's job), but it IS
    // now correctly realigned so the downstream filter can catch it. Confirmed below.
    const schema = mapToFinalBusinessSchema(result.headers, result.retainedRows, result.urlColumnIndex);
    expect(schema.rows).toHaveLength(1);
    expect(schema.rows[0]![0]).toBe("https://example.com/"); // Clean URL, derived from the realigned row's real URL
    expect(schema.rows[0]![1]).toBe("https://example.com"); // Original URL, preserved byte-for-byte
  });

  it("exact-duplicate detection operates on the REALIGNED complete row, not the raw misaligned one -- two shifted rows with identical real content are correctly recognized as duplicates", () => {
    const rowA = shiftRight(realRow("1", "https://dup.com", "50", "1000", "20", "5000"), 3);
    const rowB = shiftRight(realRow("1", "https://dup.com", "50", "1000", "20", "5000"), 3);
    const result = buildCleaningResult(HEADERS, [rowA, rowB]);
    expect(result.exactDuplicateGroups).toHaveLength(1);
    expect(result.exactDuplicateGroups[0]!.rowIndexes).toEqual([0, 1]);
    expect(result.retainedRows).toHaveLength(1);
  });
});

describe("end-to-end: mapToFinalBusinessSchema + splitByOrganicTraffic on a mixed aligned/shifted/short dataset", () => {
  // A realistic mixed batch: row 0 aligned, rows 1-3 shifted +3 (the real defect shape), row 4 shifted +2
  // (a different offset -- proves the fix isn't hardcoded to 3), row 5 a genuinely short/incomplete row.
  const rows = [
    realRow("1", "https://alpha.com", "10", "999", "5", "42000"), // aligned, >=1000 traffic -> Admin/Vendor
    shiftRight(realRow("2", "https://beta.com", "20", "888", "6", "500"), 3), // shifted +3, <1000 -> Client Sheet
    shiftRight(realRow("3", "https://gamma.com", "30", "777", "7", "1500"), 3), // shifted +3, >=1000 -> Admin/Vendor
    shiftRight(realRow("4", "", "40", "666", "8", "700"), 3), // shifted +3, genuinely no URL -> preserved as blank
    shiftRight(realRow("5", "https://epsilon.com", "50", "555", "9", "999"), 2), // shifted +2, <1000 -> Client Sheet
    ["6", "query"], // genuinely short/incomplete row (no URL column at all)
  ];

  const cleaning = buildCleaningResult(HEADERS, rows);
  const schema = mapToFinalBusinessSchema(cleaning.headers, cleaning.retainedRows, cleaning.urlColumnIndex);
  const split = splitByOrganicTraffic(schema);

  const cleanIdx = schema.headers.indexOf("Clean URL");
  const origIdx = schema.headers.indexOf("Original URL");
  const trafficIdx = schema.headers.indexOf("Organic Traffic");

  it("keeps URL and traffic on the SAME output record for every row that genuinely has both in the source -- never blank-URL-while-traffic-populated (row 4 and row 6 are the deliberate exceptions: row 4 genuinely has no source URL, row 6 is a genuinely short/incomplete row with neither -- both covered by their own tests)", () => {
    const knownRealUrls = ["https://alpha.com", "https://beta.com", "https://gamma.com", "https://epsilon.com"];
    const rowsWithRealSourceUrls = schema.rows.filter((r) => knownRealUrls.includes(r[origIdx] ?? ""));
    expect(rowsWithRealSourceUrls).toHaveLength(4);
    for (const row of rowsWithRealSourceUrls) {
      expect(row[cleanIdx]).not.toBe("");
      expect(row[origIdx]).not.toBe("");
      expect(row[trafficIdx]).not.toBe("");
    }
  });

  it("preserves the exact original URL byte-for-byte for a shifted record, alongside its correctly-derived Clean URL", () => {
    const betaSchemaRow = schema.rows.find((r) => r[origIdx] === "https://beta.com");
    expect(betaSchemaRow).toBeDefined();
    expect(betaSchemaRow![cleanIdx]).toBe("https://beta.com/");
  });

  it("a genuinely-blank URL (shifted row 4) stays explicitly blank -- never silently filled by a neighboring field shifting into its place", () => {
    // Row 4's traffic (700) is unique in this fixture -- find its schema row by that value and confirm
    // its URL fields are genuinely empty, not populated by some other column's value.
    const row4Schema = schema.rows.find((r) => r[trafficIdx] === "700");
    expect(row4Schema).toBeDefined();
    expect(row4Schema![cleanIdx]).toBe("");
    expect(row4Schema![origIdx]).toBe("");
  });

  it("classifies strictly by the real numeric organic traffic value -- < 1,000 to Client Sheet, >= 1,000 to Admin/Vendor, regardless of row shift amount", () => {
    const clientUrls = split.clientWebsites.rows.map((r) => r[origIdx]);
    const adminUrls = split.adminVendor.rows.map((r) => r[origIdx]);
    expect(clientUrls).toContain("https://beta.com"); // 500, shifted +3
    expect(clientUrls).toContain("https://epsilon.com"); // 999, shifted +2
    expect(adminUrls).toContain("https://alpha.com"); // 42000, aligned
    expect(adminUrls).toContain("https://gamma.com"); // 1500, shifted +3
    for (const row of split.clientWebsites.rows) {
      const cell = row[trafficIdx] ?? "";
      const raw = Number(cell.replace(/,/g, ""));
      if (!Number.isNaN(raw) && cell !== "") expect(raw).toBeLessThan(TRAFFIC_SPLIT_THRESHOLD);
    }
  });

  it("routes the <1,000 destination to the user's exact intended sheet name \"Client Sheet\" -- never \"Client Websites\"", () => {
    expect(CLIENT_WEBSITES_SHEET_NAME).toBe("Client Sheet");
    expect(CLIENT_WEBSITES_SHEET_NAME).not.toBe("Client Websites");
    expect(ADMIN_VENDOR_SHEET_NAME).toBe("Admin - Vendor");
  });

  it("every output row keeps EXACT column alignment with FINAL_BUSINESS_SCHEMA_COLUMNS -- DA/PA/SS land in their own columns, never shifted into URL/traffic", () => {
    const gammaRow = schema.rows.find((r) => r[origIdx] === "https://gamma.com");
    expect(gammaRow).toBeDefined();
    expect(gammaRow![schema.headers.indexOf("DA")]).toBe(""); // no DA alias matched in this fixture -- must stay empty, never fabricated
    expect(gammaRow![trafficIdx]).toBe("1500"); // raw numeric traffic value landed in its own column, not some other metric
    // The SAME record's WRITTEN (display-formatted) row shows the K-notation, proving splitByOrganicTraffic
    // reformats the same real traffic cell -- never a different one.
    const gammaWritten = split.adminVendor.rows.find((r) => r[origIdx] === "https://gamma.com");
    expect(gammaWritten).toBeDefined();
    expect(gammaWritten![trafficIdx]).toBe("1.5K");
  });

  it("no cross-record field shifting -- each retained record's OWN values never leak into an adjacent record's output row", () => {
    const alphaRow = schema.rows.find((r) => r[origIdx] === "https://alpha.com")!;
    const betaRow = schema.rows.find((r) => r[origIdx] === "https://beta.com")!;
    expect(alphaRow[trafficIdx]).not.toBe(betaRow[trafficIdx]);
    expect(alphaRow[origIdx]).not.toBe(betaRow[origIdx]);
  });
});

describe("multi-batch input: concatenating real API-shaped batches (mimicking getAllSpreadsheetValues) never introduces or hides an offset", () => {
  it("a shifted row that lands exactly at a batch boundary is realigned identically whether it's the last row of one batch or the first of the next", () => {
    const batchSize = 3;
    const batch1 = [
      realRow("1", "https://one.com", "1", "1", "1", "100"),
      realRow("2", "https://two.com", "2", "2", "2", "200"),
      shiftRight(realRow("3", "https://three.com", "3", "3", "3", "300"), 3), // last row of batch 1, shifted
    ];
    const batch2 = [
      shiftRight(realRow("4", "https://four.com", "4", "4", "4", "400"), 3), // first row of batch 2, shifted
      realRow("5", "https://five.com", "5", "5", "5", "500"),
    ];
    expect(batch1).toHaveLength(batchSize);

    // The real getAllSpreadsheetValues() does exactly this: values.push(...result.values) per batch.
    const allRows: string[][] = [];
    allRows.push(...batch1);
    allRows.push(...batch2);

    const result = buildCleaningResult(HEADERS, allRows);
    expect(result.retainedRows).toHaveLength(5);
    const urlIdx = HEADERS.indexOf("URL");
    const trafficIdx = HEADERS.indexOf("Domain Search Traffic (ST)");
    const byUrl = new Map(result.retainedRows.map((r) => [r[urlIdx], r]));
    expect(byUrl.get("https://three.com")?.[trafficIdx]).toBe("300");
    expect(byUrl.get("https://four.com")?.[trafficIdx]).toBe("400");
    expect(result.incompleteRows).toEqual([]);
    expect(result.malformedUrlRows).toEqual([]);
  });
});
