// SPREADSHEET CLEANING LOGIC: real, deterministic, no-mocks coverage for server/backend/
// spreadsheet-cleaning.ts. Every fixture here is a small, synthetic, hand-constructed row set --
// structurally similar to a real prospect sheet's shape, never real production data.

import { describe, expect, it } from "vitest";
import {
  normalizeDomain,
  detectUrlColumnIndex,
  findMalformedUrlRows,
  findIncompleteRows,
  findDomainDuplicateCandidates,
  buildCleaningResult,
  buildCleaningAuditCsv,
  detectDomainLevelDedupIntent,
  collapseDomainDuplicatesToOnePerDomain,
  KNOWN_LARGE_PLATFORM_DOMAINS,
} from "../../../src/server/backend/spreadsheet-cleaning";

describe("normalizeDomain -- deterministic URL/domain normalization", () => {
  it("4: normalizes equivalent forms of the same domain to the identical value", () => {
    expect(normalizeDomain("https://Example.com/page?x=1")).toBe("example.com");
    expect(normalizeDomain("http://www.example.com")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
  });

  it("4: is deterministic -- the same input always produces the same output", () => {
    const results = Array.from({ length: 5 }, () => normalizeDomain("https://www.Example.com/foo"));
    expect(new Set(results).size).toBe(1);
  });

  it("5: returns null for a clearly malformed value (never fabricates a domain)", () => {
    expect(normalizeDomain("not a url at all")).toBeNull();
    expect(normalizeDomain("htp:/broken-url")).toBeNull();
    expect(normalizeDomain("just-one-label")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("detectUrlColumnIndex -- schema-agnostic column auto-detection", () => {
  it("finds a column by header name (url/website/domain/link/site)", () => {
    expect(detectUrlColumnIndex(["Name", "Website", "Email"])).toBe(1);
    expect(detectUrlColumnIndex(["Company", "Domain", "Contact"])).toBe(1);
    expect(detectUrlColumnIndex(["URL"])).toBe(0);
  });

  it("returns null (never guesses) when no header matches", () => {
    expect(detectUrlColumnIndex(["Name", "Email", "Phone"])).toBeNull();
  });
});

describe("findMalformedUrlRows -- 5: malformed URLs are flagged", () => {
  it("flags a non-empty, unparseable URL value", () => {
    const headers = ["Domain", "Email"];
    const rows = [
      ["example.com", "a@example.com"],
      ["not a real url", "b@example.com"],
      ["", "c@example.com"], // empty -- handled by incomplete-record detection instead, not malformed
    ];
    const flags = findMalformedUrlRows(rows, detectUrlColumnIndex(headers));
    expect(flags).toEqual([{ rowIndex: 1, rawValue: "not a real url" }]);
  });

  it("returns empty (never guesses) when no URL column is detected", () => {
    expect(findMalformedUrlRows([["a", "b"]], null)).toEqual([]);
  });
});

describe("findIncompleteRows -- 6: clearly incomplete records are flagged without inventing values", () => {
  it("flags a row missing the detected URL/domain column", () => {
    const headers = ["Domain", "Email", "Company"];
    const rows = [
      ["example.com", "a@example.com", "Acme"],
      ["", "b@example.com", "Beta"],
    ];
    const flags = findIncompleteRows(rows, detectUrlColumnIndex(headers));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.rowIndex).toBe(1);
  });

  it("flags a mostly-blank row even with no URL column detected", () => {
    const rows = [
      ["Acme", "a@example.com", "555-1234"],
      ["", "", "555-9999"],
    ];
    const flags = findIncompleteRows(rows, null);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.rowIndex).toBe(1);
  });

  it("never invents a value -- the reason cites only real, observable facts about the row", () => {
    const flags = findIncompleteRows([["", "", "x"]], null);
    expect(flags[0]!.reason).toMatch(/\d+ of \d+ columns/);
  });
});

describe("findDomainDuplicateCandidates -- 3: same-domain/different-row records are flagged, never auto-deleted", () => {
  it("flags two rows sharing a normalized domain but with different other field values", () => {
    const headers = ["Domain", "Contact"];
    const rows = [
      ["example.com", "Alice"],
      ["www.example.com", "Bob"], // same normalized domain, different contact
    ];
    const groups = findDomainDuplicateCandidates(rows, detectUrlColumnIndex(headers), new Set());
    expect(groups).toEqual([{ normalizedDomain: "example.com", rowIndexes: [0, 1] }]);
  });

  it("does not flag a domain group where every row is already an exact duplicate of another (avoids double-reporting)", () => {
    const headers = ["Domain", "Contact"];
    const rows = [
      ["example.com", "Alice"],
      ["example.com", "Alice"], // identical to row 0
    ];
    const groups = findDomainDuplicateCandidates(rows, detectUrlColumnIndex(headers), new Set([0, 1]));
    expect(groups).toEqual([]);
  });

  it("returns empty when no URL column is detected", () => {
    expect(findDomainDuplicateCandidates([["a", "b"]], null, new Set())).toEqual([]);
  });
});

describe("buildCleaningResult -- 1/2/7/10: the full, deterministic end-to-end computation", () => {
  const headers = ["Domain", "Contact", "Email"];
  const rows = [
    ["example.com", "Alice", "alice@example.com"], // row 0: unique
    ["example.com", "Alice", "alice@example.com"], // row 1: EXACT duplicate of row 0
    ["example.org", "Bob", "bob@example.org"], // row 2: unique
    ["www.example.org", "Carol", "carol@example.org"], // row 3: domain-duplicate candidate with row 2 (differs)
    ["not-a-real-url", "Dave", "dave@example.com"], // row 4: malformed URL
    ["", "", ""], // row 5: incomplete
  ];

  it("1/2: exact duplicates are grouped deterministically, running twice yields the identical result", () => {
    const a = buildCleaningResult(headers, rows);
    const b = buildCleaningResult(headers, rows);
    expect(a).toEqual(b);
    expect(a.exactDuplicateGroups).toEqual([{ rowIndexes: [0, 1], values: ["example.com", "Alice", "alice@example.com"] }]);
  });

  it("7: valid unique records are preserved -- only the exact-duplicate EXTRA occurrence is removed", () => {
    const result = buildCleaningResult(headers, rows);
    expect(result.retainedRowIndexes).toEqual([0, 2, 3, 4, 5]); // row 1 removed (extra exact dup); everything else kept
    expect(result.retainedRows).toHaveLength(5);
  });

  it("3: the domain-duplicate candidate (rows 2/3) is flagged for manual review but STILL retained, never deleted", () => {
    const result = buildCleaningResult(headers, rows);
    expect(result.domainDuplicateGroups).toEqual([{ normalizedDomain: "example.org", rowIndexes: [2, 3] }]);
    expect(result.retainedRowIndexes).toContain(2);
    expect(result.retainedRowIndexes).toContain(3);
  });

  it("5/6: malformed and incomplete rows are flagged but STILL retained, never deleted", () => {
    const result = buildCleaningResult(headers, rows);
    expect(result.malformedUrlRows).toEqual([{ rowIndex: 4, rawValue: "not-a-real-url" }]);
    expect(result.incompleteRows.map((f) => f.rowIndex)).toContain(5);
    expect(result.retainedRowIndexes).toContain(4);
    expect(result.retainedRowIndexes).toContain(5);
  });

  it("10: the clean dataset preserves the exact original column headers, unchanged", () => {
    const result = buildCleaningResult(headers, rows);
    expect(result.headers).toEqual(headers);
  });

  it("manualReviewRowIndexes is the sorted union of domain-duplicate/malformed/incomplete row indexes", () => {
    const result = buildCleaningResult(headers, rows);
    expect(result.manualReviewRowIndexes).toEqual([2, 3, 4, 5]);
  });

  it("never invents data -- an all-valid, no-issue sheet produces zero flags and full retention", () => {
    const cleanHeaders = ["Domain", "Contact"];
    const cleanRows = [
      ["example.com", "Alice"],
      ["example.org", "Bob"],
    ];
    const result = buildCleaningResult(cleanHeaders, cleanRows);
    expect(result.exactDuplicateGroups).toEqual([]);
    expect(result.domainDuplicateGroups).toEqual([]);
    expect(result.malformedUrlRows).toEqual([]);
    expect(result.incompleteRows).toEqual([]);
    expect(result.retainedRowIndexes).toEqual([0, 1]);
  });
});

// VALIDATED LIVE-SCALE NUMBERS (2026-09-02): reproduces the exact real, live-confirmed proportions from
// the controlled live test against "Saas Master Sheet.xlsx" (2,208 original rows; 46 exact-duplicate
// groups covering 309 rows, i.e. 263 removable/one-kept-per-group; final retained = 1,945) using a
// SYNTHETIC fixture built to the same shape -- never the real uploaded workbook, per this turn's own
// zero-real-file constraint. Proves buildCleaningResult() reproduces this exact arithmetic at scale.
describe("buildCleaningResult -- validated live-scale numbers (1/2/3: 2,208 -> 1,945 retained, 263 removed, 46 groups)", () => {
  function buildSyntheticFixture() {
    const headers = ["Domain", "Contact"];
    const rows: string[][] = [];

    // 46 exact-duplicate groups summing to 309 total member rows: 33 groups of size 7 + 13 groups of
    // size 6 (33*7 + 13*6 = 231 + 78 = 309), each group's rows placed contiguously and interleaved with
    // unique filler rows so duplicate detection isn't trivially aided by adjacency alone.
    const groupSizes = [...Array(33).fill(7), ...Array(13).fill(6)];
    let uniqueCounter = 0;
    for (let g = 0; g < groupSizes.length; g++) {
      const domain = `dup-group-${g}.example.com`;
      for (let m = 0; m < groupSizes[g]!; m++) {
        rows.push([domain, "Same Contact"]);
      }
      // A few unique filler rows between groups.
      for (let f = 0; f < 3; f++) {
        rows.push([`unique-${uniqueCounter}.example.org`, `Contact ${uniqueCounter}`]);
        uniqueCounter++;
      }
    }
    // Pad with remaining unique rows to reach exactly 2,208 total.
    while (rows.length < 2208) {
      rows.push([`unique-${uniqueCounter}.example.org`, `Contact ${uniqueCounter}`]);
      uniqueCounter++;
    }
    return { headers, rows };
  }

  it("1: 2,208 original rows produce exactly 1,945 retained records", () => {
    const { headers, rows } = buildSyntheticFixture();
    expect(rows.length).toBe(2208);
    const result = buildCleaningResult(headers, rows);
    expect(result.originalRowCount).toBe(2208);
    expect(result.retainedRowIndexes.length).toBe(1945);
  });

  it("2: exactly 263 exact-duplicate rows are removed", () => {
    const { headers, rows } = buildSyntheticFixture();
    const result = buildCleaningResult(headers, rows);
    const totalGroupRows = result.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0);
    const removed = totalGroupRows - result.exactDuplicateGroups.length; // one kept per group
    expect(totalGroupRows).toBe(309);
    expect(removed).toBe(263);
    expect(result.originalRowCount - result.retainedRowIndexes.length).toBe(263);
  });

  it("3: exactly 46 exact-duplicate groups each retain exactly one representative", () => {
    const { headers, rows } = buildSyntheticFixture();
    const result = buildCleaningResult(headers, rows);
    expect(result.exactDuplicateGroups.length).toBe(46);
    for (const group of result.exactDuplicateGroups) {
      const [keptIndex, ...removedIndexes] = group.rowIndexes;
      expect(result.retainedRowIndexes).toContain(keptIndex);
      for (const removedIndex of removedIndexes) {
        expect(result.retainedRowIndexes).not.toContain(removedIndex);
      }
    }
  });
});

describe("buildCleaningAuditCsv -- 8/9: a real, reviewable CSV audit explaining every proposed action", () => {
  const headers = ["Domain", "Contact"];
  const rows = [
    ["example.com", "Alice"],
    ["example.com", "Alice"], // exact duplicate of row 0
    ["example.org", "Bob"],
    ["www.example.org", "Carol"], // domain-duplicate candidate with row 2
    ["not-a-real-url", "Dave"], // malformed
    ["", ""], // incomplete
  ];

  it("produces a well-formed CSV with the required header row", () => {
    const result = buildCleaningResult(headers, rows);
    const csv = buildCleaningAuditCsv(result);
    const firstLine = csv.split("\r\n")[0];
    expect(firstLine).toContain("Category");
    expect(firstLine).toContain("Duplicate Type");
    expect(firstLine).toContain("Reason");
    expect(firstLine).toContain("Proposed Action");
    expect(firstLine).toContain("Final Disposition");
  });

  it("9: covers all four required sections (A exact duplicate, B domain candidate, C malformed/incomplete, D valid retained)", () => {
    const result = buildCleaningResult(headers, rows);
    const csv = buildCleaningAuditCsv(result);
    expect(csv).toContain("A_EXACT_DUPLICATE_REMOVED");
    expect(csv).toContain("B_DOMAIN_DUPLICATE_CANDIDATE");
    expect(csv).toContain("C_MALFORMED_OR_INCOMPLETE");
    expect(csv).toContain("D_VALID_RETAINED");
  });

  it("9: every proposed removal/merge row states a real reason and proposed action -- never blank", () => {
    const result = buildCleaningResult(headers, rows);
    const csv = buildCleaningAuditCsv(result);
    const dataLines = csv.split("\r\n").filter((line) => line.startsWith("A_") || line.startsWith("B_"));
    expect(dataLines.length).toBeGreaterThan(0);
    for (const line of dataLines) {
      expect(line).toMatch(/identical values in every column|same normalized domain, but other column values differ/i);
    }
  });

  it("does not invent information -- domain values in the audit match the real normalizeDomain() output already computed on the CleaningResult", () => {
    const result = buildCleaningResult(headers, rows);
    const csv = buildCleaningAuditCsv(result);
    expect(csv).toContain("example.org"); // the real normalized domain from the domain-duplicate group
  });
});

// REAL, LIVE-CONFIRMED REGRESSION (2026-09-24): a genuine live chat request --
// "Remove exact duplicates and apply one-record-per-domain cleanup, excluding large platform domains." --
// did NOT collapse domain duplicates at all (still just flagged them), reported and confirmed via a live
// PDF transcript. Two real, distinct root causes, both covered below: (1) the phrase detector required
// literal whitespace between words (\s+), so the real, HYPHENATED wording "one-record-per-domain" never
// matched at all; (2) google-sheets-cleaning.ts's processSelectedGoogleSheet() (the "clean a source sheet
// into the configured destination" flow the live request actually reached) had never been wired to this
// collapse logic in the first place -- only the separate, narrower "Admin - Vendor"/"Client Sheet" self-
// cleanup flow had it. See google-sheets-cleaning.test.ts for regression coverage of fix (2).
describe("detectDomainLevelDedupIntent -- shared phrase detection for BOTH cleaning flows", () => {
  it("REGRESSION: matches the exact real, hyphenated phrasing from the live-confirmed defect report ('one-record-per-domain', no spaces)", () => {
    expect(detectDomainLevelDedupIntent("Remove exact duplicates and apply one-record-per-domain cleanup, excluding large platform domains.")).toEqual({
      dedupeByDomain: true,
      excludePlatformDomains: true,
    });
  });

  it("still matches the original, space-separated phrasing (not a regression against prior behavior)", () => {
    expect(detectDomainLevelDedupIntent("Keep one record per domain and remove duplicates.")).toEqual({ dedupeByDomain: true, excludePlatformDomains: false });
    expect(detectDomainLevelDedupIntent("One unique row per website, please.")).toEqual({ dedupeByDomain: true, excludePlatformDomains: false });
  });

  it("matches hyphenated 'per-domain'/'per-website' on their own too, not just the full 'one-record-per-domain' phrase", () => {
    expect(detectDomainLevelDedupIntent("Please dedupe per-domain across the sheet.")).toEqual({ dedupeByDomain: true, excludePlatformDomains: false });
  });

  it("excludePlatformDomains forces dedupeByDomain true even with no separate 'per domain' phrase -- exclusion is meaningless without collapsing", () => {
    expect(detectDomainLevelDedupIntent("Clean this up, excluding large platform domains.")).toEqual({ dedupeByDomain: true, excludePlatformDomains: true });
  });

  it("returns both false for a plain 'remove duplicates' request with no domain-level language at all", () => {
    expect(detectDomainLevelDedupIntent("Please remove duplicates from this sheet.")).toEqual({ dedupeByDomain: false, excludePlatformDomains: false });
  });

  it("KNOWN_LARGE_PLATFORM_DOMAINS is a real, non-empty, exported list usable by both flows", () => {
    expect(KNOWN_LARGE_PLATFORM_DOMAINS.length).toBeGreaterThan(10);
    expect(KNOWN_LARGE_PLATFORM_DOMAINS).toContain("linkedin.com");
  });
});

describe("collapseDomainDuplicatesToOnePerDomain -- exported from the shared module, usable by any caller", () => {
  it("collapses a real domain-duplicate group down to its lowest-indexed row, leaving everything else untouched", () => {
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://alpha.com/a", "40"],
      ["https://beta.com", "10"],
      ["https://alpha.com/b", "41"],
    ];
    const base = buildCleaningResult(headers, rows);
    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);
    expect(collapsed.result.retainedRowIndexes).toEqual([0, 1]);
  });
});
