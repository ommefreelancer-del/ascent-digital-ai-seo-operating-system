// FINAL BUSINESS OUTPUT SCHEMA: real, deterministic, no-mocks coverage for server/backend/
// spreadsheet-business-schema.ts. Fixtures deliberately mirror a REAL Ahrefs-style export shape (DR, AR,
// referring domains, organic keywords, ...) to prove the mapping never confuses an unrelated metric
// (Ahrefs' own "AR" / Ahrefs Rank, or "DR" itself -- intentionally not a final business column) with the
// target schema's DA/PA/SS/Domain Age columns.

import { describe, expect, it } from "vitest";
import {
  FINAL_BUSINESS_SCHEMA_COLUMNS,
  mapToFinalBusinessSchema,
  deriveCleanRootUrl,
  formatTrafficDisplay,
  splitByOrganicTraffic,
  TRAFFIC_SPLIT_THRESHOLD,
  ADMIN_VENDOR_SHEET_NAME,
  CLIENT_WEBSITES_SHEET_NAME,
  BUSINESS_SCHEMA_COLUMN_WIDTHS,
  BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS,
} from "../../../src/server/backend/spreadsheet-business-schema";
import { detectUrlColumnIndex, buildCleaningResult } from "../../../src/server/backend/spreadsheet-cleaning";

describe("FINAL_BUSINESS_SCHEMA_COLUMNS -- 1/2/3: exact 17-column order, two URL columns, no DR, no Deal Date", () => {
  it("1: has exactly 17 columns", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).toHaveLength(17);
  });

  it("2: matches the exact required order", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).toEqual([
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
    ]);
  });

  it("3: contains no 'Deal Date' column", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).not.toContain("Deal Date");
  });

  it("contains no 'DR' column -- intentionally removed, not a final business column", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).not.toContain("DR");
  });

  it("contains no bare 'URL' or 'Traffic' column -- replaced by 'Original URL'/'Clean URL' and 'Organic Traffic'", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).not.toContain("URL");
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS).not.toContain("Traffic");
  });

  it("Clean URL and Original URL are adjacent, Clean URL first (locked column 1/2 order)", () => {
    const cleanIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL");
    const originalIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL");
    expect(cleanIndex).toBe(0);
    expect(originalIndex).toBe(1);
  });

  it("DA/PA/SS/Organic Traffic are columns 3/4/5/6, four distinct columns", () => {
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("DA")).toBe(2);
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("PA")).toBe(3);
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("SS")).toBe(4);
    expect(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Organic Traffic")).toBe(5);
  });
});

// WRAP-TEXT / FIXED-WIDTH VISUAL FIX (2026-09-03): presentation-only layout metadata alongside the schema
// -- Clean URL gets a short fixed width, Original URL gets a wider fixed width AND wrap-text (so a long
// path/query string wraps inside its own cell instead of spilling into DA/PA/SS/Organic Traffic), every
// other column keeps xlsx-writer's generic content-derived auto-width. None of this touches the column
// set/order, the mapping logic, or the traffic split.
describe("BUSINESS_SCHEMA_COLUMN_WIDTHS / BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS -- presentation layout, never changes the schema itself", () => {
  it("has one width entry per schema column, aligned index-for-index with FINAL_BUSINESS_SCHEMA_COLUMNS", () => {
    expect(BUSINESS_SCHEMA_COLUMN_WIDTHS).toHaveLength(FINAL_BUSINESS_SCHEMA_COLUMNS.length);
  });

  it("Clean URL (column 1) gets a short fixed width", () => {
    expect(BUSINESS_SCHEMA_COLUMN_WIDTHS[FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL")]).toBe(32);
  });

  it("Original URL (column 2) gets a wider fixed width than Clean URL", () => {
    const originalWidth = BUSINESS_SCHEMA_COLUMN_WIDTHS[FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL")]!;
    const cleanWidth = BUSINESS_SCHEMA_COLUMN_WIDTHS[FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL")]!;
    expect(originalWidth).toBe(60);
    expect(originalWidth).toBeGreaterThan(cleanWidth);
  });

  it("every non-URL column has no width override -- falls back to the generic auto-width", () => {
    for (const column of FINAL_BUSINESS_SCHEMA_COLUMNS) {
      if (column === "Clean URL" || column === "Original URL") continue;
      expect(BUSINESS_SCHEMA_COLUMN_WIDTHS[FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf(column)]).toBeUndefined();
    }
  });

  it("only Original URL is marked for wrap-text -- Clean URL and every metric column are not", () => {
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).toEqual([FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL")]);
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).not.toContain(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL"));
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).not.toContain(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("DA"));
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).not.toContain(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("PA"));
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).not.toContain(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("SS"));
    expect(BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS).not.toContain(FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Organic Traffic"));
  });
});

describe("mapToFinalBusinessSchema -- 4/5/6/7/8: maps only genuinely verified source columns, never fabricates", () => {
  // A realistic Ahrefs-style export: AR (Ahrefs Rank) and DR (Domain Rating) are DIFFERENT metrics from
  // the target schema's DA/PA/SS -- neither may ever be silently renamed into them, and DR must never
  // appear anywhere in the final output at all.
  const sourceHeaders = ["Domain", "DR", "AR", "Referring Domains", "Organic Keywords", "Organic Traffic", "Email"];
  const sourceRows = [
    ["example.com", "45", "1200000", "312", "5400", "18000", "contact@example.com"],
    ["example.org", "60", "980000", "500", "8100", "42000", ""],
  ];
  const urlColumnIndex = detectUrlColumnIndex(sourceHeaders);

  it("4: Organic Traffic maps correctly from its real, genuinely equivalent source column", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    const trafficIndex = result.headers.indexOf("Organic Traffic");
    expect(result.rows[0]![trafficIndex]).toBe("18000");
    expect(result.rows[1]![trafficIndex]).toBe("42000");
    expect(result.mappedColumns.has("Organic Traffic")).toBe(true);
  });

  it("DR is never mapped anywhere -- not a final business column, regardless of a real 'DR' source column existing", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    expect(result.headers).not.toContain("DR");
    expect(Array.from(result.mappedColumns)).not.toContain("DR");
  });

  it("Clean URL and Original URL both map from the same urlColumnIndex the cleaning logic itself already detected", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    const cleanIndex = result.headers.indexOf("Clean URL");
    const originalIndex = result.headers.indexOf("Original URL");
    expect(result.rows[0]![originalIndex]).toBe("example.com");
    expect(result.rows[0]![cleanIndex]).toBe("https://example.com/");
    expect(result.mappedColumns.has("Original URL")).toBe(true);
    expect(result.mappedColumns.has("Clean URL")).toBe(true);
  });

  it("5: DA/PA/SS/Domain Age are never fabricated -- left empty when no verified source exists, and 'AR'/'DR' are never renamed into them", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    for (const column of ["DA", "PA", "SS", "Domain Age"] as const) {
      const index = result.headers.indexOf(column);
      expect(result.rows[0]![index]).toBe("");
      expect(result.rows[1]![index]).toBe("");
      expect(result.mappedColumns.has(column)).toBe(false);
    }
  });

  it("6: Email is preserved only when verified -- present for row 0, genuinely empty for row 1 (never invented)", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    const emailIndex = result.headers.indexOf("Email");
    expect(result.rows[0]![emailIndex]).toBe("contact@example.com");
    expect(result.rows[1]![emailIndex]).toBe("");
  });

  it("6: Contact Email / Contact Name are never confused with the bare 'Email' column -- left empty with no verified source", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    const contactEmailIndex = result.headers.indexOf("Contact Email");
    const contactNameIndex = result.headers.indexOf("Contact Name");
    expect(result.rows[0]![contactEmailIndex]).toBe("");
    expect(result.rows[0]![contactNameIndex]).toBe("");
    expect(result.mappedColumns.has("Contact Email")).toBe(false);
  });

  it("7: Category / Journal-Website-Type are not populated from unsupported assumptions -- empty with no real source column", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    expect(result.rows[0]![result.headers.indexOf("Category")]).toBe("");
    expect(result.rows[0]![result.headers.indexOf("Journal / Website Type")]).toBe("");
  });

  it("8: business/pricing fields (Admin Price, Client Price, Profit, Deal Status, Notes) remain empty unless real data exists", () => {
    const result = mapToFinalBusinessSchema(sourceHeaders, sourceRows, urlColumnIndex);
    for (const column of ["Admin Price", "Client Price", "Profit", "Deal Status", "Notes"] as const) {
      expect(result.rows[0]![result.headers.indexOf(column)]).toBe("");
      expect(result.mappedColumns.has(column)).toBe(false);
    }
  });

  it("REGRESSION (2026-09-24): a real, live-confirmed sheet header 'Admin Prices' (plural, with a trailing space) maps to the canonical 'Admin Price' schema column -- the singular-only alias previously left admin-priced rows silently undetected", () => {
    const headers = ["Domain", "Admin Prices ", "Client Prices"];
    const rows = [["example.com", "500", "600"]];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows[0]![result.headers.indexOf("Admin Price")]).toBe("500");
    expect(result.rows[0]![result.headers.indexOf("Client Price")]).toBe("600");
    expect(result.mappedColumns.has("Admin Price")).toBe(true);
    expect(result.mappedColumns.has("Client Price")).toBe(true);
  });

  it("maps a genuine business source column when one really exists (Category/Notes/Deal Status present)", () => {
    const headersWithBusinessData = ["Domain", "Category", "Deal Status", "Notes"];
    const rows = [["example.com", "SaaS", "In Progress", "Reached out twice"]];
    const result = mapToFinalBusinessSchema(headersWithBusinessData, rows, detectUrlColumnIndex(headersWithBusinessData));
    expect(result.rows[0]![result.headers.indexOf("Category")]).toBe("SaaS");
    expect(result.rows[0]![result.headers.indexOf("Deal Status")]).toBe("In Progress");
    expect(result.rows[0]![result.headers.indexOf("Notes")]).toBe("Reached out twice");
  });

  it("returns empty Original URL/Clean URL columns when no URL/domain column was detected at all -- never guesses", () => {
    const result = mapToFinalBusinessSchema(["Name", "Email"], [["Acme", "a@example.com"]], null);
    expect(result.rows[0]![result.headers.indexOf("Original URL")]).toBe("");
    expect(result.rows[0]![result.headers.indexOf("Clean URL")]).toBe("");
    expect(result.mappedColumns.has("Original URL")).toBe(false);
    expect(result.mappedColumns.has("Clean URL")).toBe(false);
  });
});

// REAL-HEADER-FORMAT FIX (2026-09-03): reproduces the EXACT real, live-confirmed header shape found in
// local data -- "Metric Name (ABBREV)" -- which the original exact-equality matching could never match
// at all, and which additionally requires distinguishing "Domain Search Traffic" from "Page Search
// Traffic" (two genuinely different Ahrefs metrics both abbreviated "(ST)") and rejecting a
// same-text-prefix-but-different metric ("Domain Search Traffic Value"). Also confirms "Domain Rating
// (DR)" is never mapped anywhere, per the latest schema removing DR entirely.
describe("mapToFinalBusinessSchema -- real 'Metric Name (ABBREV)' header format", () => {
  const REAL_HEADERS = [
    "#",
    "Search query",
    "URL",
    "Domain Rating (DR)",
    "Ahrefs Rank (AR)",
    "Domain Referring Pages (RP)",
    "Domain Referring Domains (RD)",
    "Domain Organic Keywords (KW)",
    "Domain Search Traffic (ST)",
    "Domain Search Traffic Value",
    "URL Rating (UR)",
    "Page Referring Pages (RP)",
    "Page Referring Domains (RD)",
    "Page Organic Keywords (KW)",
    "Page Search Traffic (ST)",
    "Page Search Traffic Value",
    "Page Words",
  ];
  const urlColumnIndex = detectUrlColumnIndex(REAL_HEADERS);
  const row = [
    "1",
    "some query",
    "example.com",
    "45", // Domain Rating (DR) -- must never appear anywhere in the final output
    "1200000", // Ahrefs Rank (AR) -- must never become DA/PA/SS
    "312",
    "80",
    "5400",
    "18000", // Domain Search Traffic (ST) -- the real "Organic Traffic"
    "9500", // Domain Search Traffic Value -- a DIFFERENT metric, must never be mistaken for Organic Traffic
    "38",
    "150",
    "40",
    "900",
    "2500", // Page Search Traffic (ST) -- a DIFFERENT, page-scoped metric, must never become "Organic Traffic"
    "1200",
    "600",
  ];

  it("'Domain Rating (DR)' is never mapped -- DR is not a final business column at all", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    expect(result.headers).not.toContain("DR");
    expect(result.rows[0]).not.toContain("45");
  });

  it("4: 'Domain Search Traffic (ST)' maps to Organic Traffic -- the SITE-WIDE metric, never the page-scoped one", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    expect(result.rows[0]![result.headers.indexOf("Organic Traffic")]).toBe("18000");
  });

  it("does NOT confuse 'Page Search Traffic (ST)' with 'Domain Search Traffic (ST)' -- the page-scoped value never appears in Organic Traffic", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    expect(result.rows[0]![result.headers.indexOf("Organic Traffic")]).not.toBe("2500");
  });

  it("does NOT confuse 'Domain Search Traffic Value' (a different metric with the same text prefix) with Organic Traffic", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    expect(result.rows[0]![result.headers.indexOf("Organic Traffic")]).not.toBe("9500");
  });

  it("5: 'Ahrefs Rank (AR)' is never renamed into DA/PA/SS/Domain Age -- all stay honestly empty (no Moz metrics in this real export)", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    for (const column of ["DA", "PA", "SS", "Domain Age"] as const) {
      expect(result.rows[0]![result.headers.indexOf(column)]).toBe("");
      expect(result.mappedColumns.has(column)).toBe(false);
    }
  });

  it("Original URL still maps correctly via urlColumnIndex alongside the other real headers", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    expect(result.rows[0]![result.headers.indexOf("Original URL")]).toBe("example.com");
  });

  it("no raw source columns (#, Search query, Ahrefs Rank, Domain Referring Pages/Domains, Domain Organic Keywords, Page Search Traffic, Page Words) ever appear in the final headers", () => {
    const result = mapToFinalBusinessSchema(REAL_HEADERS, [row], urlColumnIndex);
    for (const rawColumn of ["#", "Search query", "Ahrefs Rank (AR)", "Domain Referring Pages (RP)", "Domain Referring Domains (RD)", "Domain Organic Keywords (KW)", "Domain Search Traffic (ST)", "Page Search Traffic (ST)", "Page Words"]) {
      expect(result.headers as readonly string[]).not.toContain(rawColumn);
    }
  });
});

// EMBEDDED HEADER ROW REMOVAL (2026-09-03): reproduces the exact real, live-confirmed defect -- a real
// approval's retained rows were found to contain one row whose own values were, cell for cell, identical
// to the header row (a real artifact of some multi-section source exports), which exact-duplicate
// detection never catches (it only compares data rows against each other, never against the header).
describe("mapToFinalBusinessSchema -- removes an embedded header-duplicate row from the final output", () => {
  it("filters out a data row that exactly matches the header row, never treating it as a real record", () => {
    const headers = ["URL", "Domain Rating (DR)", "Email"];
    const rows = [
      ["example.com", "45", "a@example.com"],
      ["URL", "Domain Rating (DR)", "Email"], // the exact embedded header row
      ["example.org", "60", ""],
    ];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r[result.headers.indexOf("Original URL")])).toEqual(["example.com", "example.org"]);
  });

  it("is case/whitespace tolerant -- an embedded header row with different casing/spacing is still recognized", () => {
    const headers = ["URL", "Email"];
    const rows = [
      ["  url  ", "EMAIL"], // same header text, different case/whitespace
      ["example.com", "a@example.com"],
    ];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(1);
  });

  it("never removes a genuine data row that merely happens to share ONE cell value with a header", () => {
    const headers = ["URL", "Category"];
    const rows = [["example.com", "URL"]]; // "Category" column literally contains the word "URL" as data -- not an embedded header row
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(1);
  });

  // SECTION-DIVIDER HEADER-ECHO FIX (2026-09-03): a real, live-confirmed additional variant found in the
  // real workbook -- a multi-section export repeats the header text in EVERY column except column 0,
  // which instead holds a row number/placeholder ("x") or a real category/section label ("Email Marketing
  // Tools"). The original exact-full-row-match filter only caught the one row where column 0 ALSO happened
  // to equal the header text -- these near-duplicates (16 of 17 columns are literal header text) survived
  // into the final output undetected. Column 0 is now never compared for a 2+-column sheet, since a
  // genuine prospect record could never coincidentally repeat that many header labels verbatim.
  it("removes a section-divider row where column 0 is a row-number/placeholder but every other column repeats the header text verbatim", () => {
    const headers = ["#", "URL", "Domain Rating (DR)", "Domain Search Traffic (ST)"];
    const rows = [
      ["x", "URL", "Domain Rating (DR)", "Domain Search Traffic (ST)"], // section-divider: col 0 is a placeholder
      ["1", "example.com", "45", "18000"], // genuine record
    ];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]![result.headers.indexOf("Original URL")]).toBe("example.com");
  });

  it("removes a section-divider row where column 0 is a real category/section label, not a placeholder", () => {
    const headers = ["#", "URL", "Domain Rating (DR)", "Domain Search Traffic (ST)"];
    const rows = [
      ["Email Marketing Tools", "URL", "Domain Rating (DR)", "Domain Search Traffic (ST)"], // section divider
      ["1", "example.com", "45", "18000"], // genuine record
    ];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]![result.headers.indexOf("Original URL")]).toBe("example.com");
  });

  it("never removes a genuine record just because column 0 alone happens to equal a header-like string, when the OTHER columns hold real data", () => {
    const headers = ["#", "URL", "Domain Rating (DR)"];
    const rows = [["URL", "example.com", "45"]]; // col 0 coincidentally equals "URL" -- but URL/DR columns hold genuine data, not header echoes
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    expect(result.rows).toHaveLength(1);
  });
});

describe("mapToFinalBusinessSchema -- 9/10: applied AFTER cleaning, never changes duplicate/retention behavior", () => {
  it("operates on already-cleaned (retained) rows -- exact duplicate removal and domain-candidate retention are untouched by schema mapping", () => {
    const headers = ["Domain", "Contact"];
    const rows = [
      ["example.com", "Alice"],
      ["example.com", "Alice"], // exact duplicate
      ["example.org", "Bob"],
      ["www.example.org", "Carol"], // domain-duplicate candidate, retained
    ];
    const cleaningResult = buildCleaningResult(headers, rows);
    expect(cleaningResult.retainedRowIndexes).toEqual([0, 2, 3]); // 9: exact dup removed, others retained
    expect(cleaningResult.domainDuplicateGroups).toHaveLength(1); // 10: flagged, not deleted

    const businessSchema = mapToFinalBusinessSchema(cleaningResult.headers, cleaningResult.retainedRows, cleaningResult.urlColumnIndex);
    expect(businessSchema.rows).toHaveLength(3); // same 3 retained rows, just reshaped into the business schema
  });
});

describe("deriveCleanRootUrl -- deterministic DOMAIN-LEVEL ROOT URL derivation, never overwrites Original URL", () => {
  it("real example: a full page URL reduces to the domain root", () => {
    expect(deriveCleanRootUrl("https://instatus.com/blog/write-for-us")).toBe("https://instatus.com/");
  });

  it("adds an explicit https:// scheme when the source has none", () => {
    expect(deriveCleanRootUrl("example.com")).toBe("https://example.com/");
  });

  it("preserves an explicit http:// scheme -- never force-upgrades to https", () => {
    expect(deriveCleanRootUrl("http://example.com/some/page")).toBe("http://example.com/");
  });

  it("removes the page path entirely, regardless of depth", () => {
    expect(deriveCleanRootUrl("https://example.com/a/b/c/write-for-us/")).toBe("https://example.com/");
  });

  it("removes the query string entirely", () => {
    expect(deriveCleanRootUrl("https://example.com/page?utm_source=newsletter&id=42")).toBe("https://example.com/");
  });

  it("removes the URL fragment entirely", () => {
    expect(deriveCleanRootUrl("https://example.com/page#section")).toBe("https://example.com/");
  });

  it("lowercases the hostname", () => {
    expect(deriveCleanRootUrl("https://Example.COM/Write-For-Us")).toBe("https://example.com/");
  });

  it("preserves the real domain -- never invents a different one", () => {
    expect(deriveCleanRootUrl("https://blog.incredo.co/write-for-us/")).toBe("https://blog.incredo.co/");
  });

  it("preserves a real non-default port", () => {
    expect(deriveCleanRootUrl("https://example.com:8443/page")).toBe("https://example.com:8443/");
  });

  it("returns the raw original value unchanged when it cannot be parsed as a URL at all -- never invents a different domain", () => {
    expect(deriveCleanRootUrl("not a url at all !!")).toBe("not a url at all !!");
  });

  it("returns an empty string for an empty input, never a fabricated placeholder", () => {
    expect(deriveCleanRootUrl("")).toBe("");
  });

  it("is deterministic -- the same input always produces the same output", () => {
    const input = "https://Example.com/Write-For-Us/?utm_source=x";
    expect(deriveCleanRootUrl(input)).toBe(deriveCleanRootUrl(input));
  });

  // REAL, LIVE-CONFIRMED DEFECT (2026-09-03): a genuine retained row's malformed URL cell was the literal
  // value "3" -- the WHATWG URL parser treats an all-numeric host as a 32-bit IPv4 address and silently
  // canonicalizes it into dotted-decimal notation (new URL("https://3").hostname === "0.0.0.3"), which
  // would otherwise invent a fake, meaningless IP-address "domain" out of garbage data.
  it("never invents an IPv4 address from a bare numeric value -- returns it unchanged instead", () => {
    expect(deriveCleanRootUrl("3")).toBe("3");
    expect(deriveCleanRootUrl("6887")).toBe("6887");
    expect(deriveCleanRootUrl("2128")).toBe("2128");
  });

  it("still normalizes a genuinely-typed, already-dotted numeric IP host normally (unaffected by the bare-numeric-host guard)", () => {
    expect(deriveCleanRootUrl("192.168.1.1")).toBe("https://192.168.1.1/");
    expect(deriveCleanRootUrl("https://192.168.1.1/admin")).toBe("https://192.168.1.1/");
  });
});

describe("mapToFinalBusinessSchema -- Clean URL / Original URL side by side, Clean URL never overwrites Original URL", () => {
  it("Clean URL carries the domain-root value; Original URL keeps the raw source value exactly; both present, Clean URL first", () => {
    const headers = ["URL", "Email"];
    const rows = [["INSTATUS.com/blog/Write-For-Us?utm_source=x", "a@example.com"]];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    const cleanIndex = result.headers.indexOf("Clean URL");
    const originalIndex = result.headers.indexOf("Original URL");
    expect(cleanIndex).toBeLessThan(originalIndex);
    expect(result.rows[0]![cleanIndex]).toBe("https://instatus.com/");
    expect(result.rows[0]![originalIndex]).toBe("INSTATUS.com/blog/Write-For-Us?utm_source=x");
    expect(result.rows[0]![cleanIndex]).not.toBe(result.rows[0]![originalIndex]);
  });

  it("no DA/PA/SS/DR metric value ever appears embedded inside either URL cell", () => {
    const headers = ["URL", "Domain Rating (DR)", "Domain Authority", "Page Authority", "Spam Score"];
    const rows = [["https://example.com/write-for-us", "45", "38", "29", "2"]];
    const result = mapToFinalBusinessSchema(headers, rows, detectUrlColumnIndex(headers));
    const cleanIndex = result.headers.indexOf("Clean URL");
    const originalIndex = result.headers.indexOf("Original URL");
    for (const metricValue of ["45", "38", "29", "2"]) {
      expect(result.rows[0]![cleanIndex]).not.toContain(metricValue);
      expect(result.rows[0]![originalIndex]).not.toContain(metricValue);
    }
    expect(result.rows[0]![result.headers.indexOf("DA")]).toBe("38");
    expect(result.rows[0]![result.headers.indexOf("PA")]).toBe("29");
    expect(result.rows[0]![result.headers.indexOf("SS")]).toBe("2");
  });
});

describe("formatTrafficDisplay -- required display formatting rules", () => {
  it("below 1,000: shows the actual number, unrounded", () => {
    expect(formatTrafficDisplay("900")).toBe("900");
    expect(formatTrafficDisplay("850")).toBe("850");
    expect(formatTrafficDisplay("450")).toBe("450");
    expect(formatTrafficDisplay("999")).toBe("999");
  });

  it("1,000-999,999: K notation, at most one decimal place", () => {
    expect(formatTrafficDisplay("1000")).toBe("1K");
    expect(formatTrafficDisplay("2500")).toBe("2.5K");
    expect(formatTrafficDisplay("25000")).toBe("25K");
    expect(formatTrafficDisplay("850000")).toBe("850K");
  });

  it("1,000,000+: M notation, at most one decimal place", () => {
    expect(formatTrafficDisplay("1000000")).toBe("1M");
    expect(formatTrafficDisplay("2500000")).toBe("2.5M");
    expect(formatTrafficDisplay("12500000")).toBe("12.5M");
  });

  it("handles thousands-separator input and never fabricates a number for missing/invalid input", () => {
    expect(formatTrafficDisplay("18,000")).toBe("18K");
    expect(formatTrafficDisplay("")).toBe("");
    expect(formatTrafficDisplay("n/a")).toBe("n/a");
  });
});

describe("splitByOrganicTraffic -- required threshold boundaries and completeness", () => {
  function schemaFor(trafficValues: readonly string[]) {
    const headers = FINAL_BUSINESS_SCHEMA_COLUMNS;
    const rows = trafficValues.map((traffic, i) => {
      const row = new Array(headers.length).fill("");
      row[headers.indexOf("Original URL")] = `site${i}.example.com`;
      row[headers.indexOf("Organic Traffic")] = traffic;
      return row;
    });
    return { headers, rows, mappedColumns: new Set<(typeof FINAL_BUSINESS_SCHEMA_COLUMNS)[number]>(["Original URL", "Organic Traffic"]) };
  }

  it("900 -> Client Websites", () => {
    const split = splitByOrganicTraffic(schemaFor(["900"]));
    expect(split.clientWebsites.rows).toHaveLength(1);
    expect(split.adminVendor.rows).toHaveLength(0);
  });

  it("999 -> Client Websites", () => {
    const split = splitByOrganicTraffic(schemaFor(["999"]));
    expect(split.clientWebsites.rows).toHaveLength(1);
    expect(split.adminVendor.rows).toHaveLength(0);
  });

  it("1,000 -> Admin/Vendor (threshold is inclusive)", () => {
    const split = splitByOrganicTraffic(schemaFor(["1000"]));
    expect(split.adminVendor.rows).toHaveLength(1);
    expect(split.clientWebsites.rows).toHaveLength(0);
    expect(TRAFFIC_SPLIT_THRESHOLD).toBe(1000);
  });

  it("1,001 -> Admin/Vendor", () => {
    const split = splitByOrganicTraffic(schemaFor(["1001"]));
    expect(split.adminVendor.rows).toHaveLength(1);
    expect(split.clientWebsites.rows).toHaveLength(0);
  });

  it("applies the threshold to the raw numeric value, never a rounded one (999.6 stays below 1,000)", () => {
    const split = splitByOrganicTraffic(schemaFor(["999.6"]));
    expect(split.clientWebsites.rows).toHaveLength(1);
    expect(split.adminVendor.rows).toHaveLength(0);
  });

  it("unverified/unparseable traffic is never assumed high-traffic -- routed to Client Websites, never Admin/Vendor", () => {
    const split = splitByOrganicTraffic(schemaFor(["", "not-a-number"]));
    expect(split.clientWebsites.rows).toHaveLength(2);
    expect(split.adminVendor.rows).toHaveLength(0);
  });

  it("verify no record appears in both destinations, and no record is lost from the split", () => {
    const trafficValues = ["900", "999", "1000", "1001", "2500", "1000000", "", "not-a-number"];
    const schema = schemaFor(trafficValues);
    const split = splitByOrganicTraffic(schema);

    const urlIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL");
    const adminUrls = split.adminVendor.rows.map((r) => r[urlIndex]);
    const clientUrls = split.clientWebsites.rows.map((r) => r[urlIndex]);
    const allUrls = [...adminUrls, ...clientUrls];

    expect(new Set(allUrls).size).toBe(allUrls.length); // no record in both
    expect(allUrls).toHaveLength(trafficValues.length); // no record lost
    expect(adminUrls.length + clientUrls.length).toBe(schema.rows.length);
  });

  it("reformats the Organic Traffic cell for display in each destination's own output, independent of the split decision", () => {
    const split = splitByOrganicTraffic(schemaFor(["2500", "1000000", "900"]));
    const trafficIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Organic Traffic");
    expect(split.adminVendor.rows.map((r) => r[trafficIndex])).toEqual(expect.arrayContaining(["2.5K", "1M"]));
    expect(split.clientWebsites.rows[0]![trafficIndex]).toBe("900");
  });

  it("both destinations use the exact same 17-column schema and order", () => {
    const split = splitByOrganicTraffic(schemaFor(["500", "1500"]));
    expect(split.adminVendor.headers).toEqual(FINAL_BUSINESS_SCHEMA_COLUMNS);
    expect(split.clientWebsites.headers).toEqual(FINAL_BUSINESS_SCHEMA_COLUMNS);
  });

  it("uses distinct, real destination sheet names", () => {
    expect(ADMIN_VENDOR_SHEET_NAME).not.toBe(CLIENT_WEBSITES_SHEET_NAME);
    expect(ADMIN_VENDOR_SHEET_NAME.length).toBeGreaterThan(0);
    expect(CLIENT_WEBSITES_SHEET_NAME.length).toBeGreaterThan(0);
  });
});
