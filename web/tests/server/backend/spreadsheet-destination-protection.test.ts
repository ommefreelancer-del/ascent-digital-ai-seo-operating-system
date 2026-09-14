// DESTINATION-PROTECTION DUPLICATE RESOLUTION (2026-09-18): real regression coverage for a live-confirmed
// production defect -- readWriteDestinationForDuplicateProtection() already read the configured write
// destination's existing content and reported it, but nothing in the pipeline actually consulted that data
// when deciding which incoming Health Master records to write. A live proposal generated after explicitly
// requesting destination protection still showed only the generic Health-Master-internal cleaning stats.
// See spreadsheet-destination-protection.ts's own header for the full decision rules.
//
// Pure, deterministic function tests -- no DB, no filesystem, no network, zero live/paid API calls.

import { describe, expect, it } from "vitest";
import { applyDestinationProtection } from "@/server/backend/spreadsheet-destination-protection";
import { FINAL_BUSINESS_SCHEMA_COLUMNS, type FinalBusinessSchemaResult } from "@/server/backend/spreadsheet-business-schema";
import type { DestinationReadOutcome } from "@/server/backend/google-sheets-cleaning";

const CLEAN_URL = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL");
const ORIGINAL_URL = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL");
const ADMIN_PRICE = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Admin Price");
const CLIENT_PRICE = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Client Price");
const DEAL_STATUS = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Deal Status");
const ORGANIC_TRAFFIC = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Organic Traffic");

/** Builds one real 17-column FINAL_BUSINESS_SCHEMA_COLUMNS-shaped incoming row. */
function incomingRow(opts: { cleanUrl: string; originalUrl: string; adminPrice?: string; clientPrice?: string; dealStatus?: string; traffic?: string }): string[] {
  const row = new Array(FINAL_BUSINESS_SCHEMA_COLUMNS.length).fill("");
  row[CLEAN_URL] = opts.cleanUrl;
  row[ORIGINAL_URL] = opts.originalUrl;
  row[ADMIN_PRICE] = opts.adminPrice ?? "";
  row[CLIENT_PRICE] = opts.clientPrice ?? "";
  row[DEAL_STATUS] = opts.dealStatus ?? "";
  row[ORGANIC_TRAFFIC] = opts.traffic ?? "5000";
  return row;
}

function schema(rows: readonly (readonly string[])[]): FinalBusinessSchemaResult {
  return { headers: FINAL_BUSINESS_SCHEMA_COLUMNS, rows, mappedColumns: new Set() };
}

/** A real destination read outcome -- deliberately DIFFERENT header names from FINAL_BUSINESS_SCHEMA_COLUMNS
 * (e.g. "Website" not "Original URL") to prove matching is by real header-name detection, never assumed to
 * mirror the business schema's own column names. */
function destinationOk(rows: readonly (readonly string[])[]): Extract<DestinationReadOutcome, { status: "ok" }> {
  const headers = ["Website", "Admin Price", "Deal Status"];
  return { status: "ok", destinationId: "dest-1", destinationName: "Admin Sheet Health", headers, rows, rowsRead: rows.length, pricingColumnsDetected: ["Admin Price", "Deal Status"] };
}

describe("applyDestinationProtection -- existing destination records are the protected baseline", () => {
  it("1: an existing PRICED destination record is never overwritten/deleted -- the incoming duplicate is OMITTED instead", () => {
    const destination = destinationOk([["https://already-priced.com", "500", "done"]]);
    const incoming = schema([incomingRow({ cleanUrl: "https://already-priced.com/", originalUrl: "https://already-priced.com" })]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.applied).toBe(true);
    expect(result.eligibleRows).toHaveLength(0);
    expect(result.protectedOmittedRows).toHaveLength(1);
    expect(result.flaggedForManualReviewRows).toHaveLength(0);
    // The existing destination row itself is never referenced for removal -- the function's own contract
    // never returns/implies deleting a destination row, only deciding about the INCOMING one.
    expect(destination.rows).toEqual([["https://already-priced.com", "500", "done"]]);
  });

  it("2: an existing UNPRICED destination record is not blindly protected -- normal duplicate rules apply, the incoming record proceeds", () => {
    const destination = destinationOk([["https://unpriced.com", "", ""]]);
    const incoming = schema([incomingRow({ cleanUrl: "https://unpriced.com/", originalUrl: "https://unpriced.com" })]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.eligibleRows).toHaveLength(1);
    expect(result.protectedOmittedRows).toHaveLength(0);
    expect(result.flaggedForManualReviewRows).toHaveLength(0);
  });

  it("3: BOTH the existing destination record and the incoming record are priced -- flagged for manual review, neither auto-included nor auto-deleted", () => {
    const destination = destinationOk([["https://both-priced.com", "500", "done"]]);
    const incoming = schema([incomingRow({ cleanUrl: "https://both-priced.com/", originalUrl: "https://both-priced.com", adminPrice: "600" })]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.eligibleRows).toHaveLength(0);
    expect(result.protectedOmittedRows).toHaveLength(0);
    expect(result.flaggedForManualReviewRows).toHaveLength(1);
    expect(destination.rows).toEqual([["https://both-priced.com", "500", "done"]]); // still untouched
  });

  it("4: a genuinely new incoming record with no destination match at all is eligible -- Health Master's new records still get added", () => {
    const destination = destinationOk([["https://existing.com", "500", "done"]]);
    const incoming = schema([incomingRow({ cleanUrl: "https://brand-new.com/", originalUrl: "https://brand-new.com" })]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.eligibleRows).toHaveLength(1);
    expect(result.eligibleRows[0]![ORIGINAL_URL]).toBe("https://brand-new.com");
  });

  it("5: mixed batch -- existing rows remain the baseline while eligible new records are added, protected duplicates omitted, both-priced flagged, all in one pass", () => {
    const destination = destinationOk([
      ["https://priced-a.com", "500", "done"],
      ["https://priced-b.com", "700", "done"],
      ["https://unpriced-c.com", "", ""],
    ]);
    const incoming = schema([
      incomingRow({ cleanUrl: "https://priced-a.com/", originalUrl: "https://priced-a.com" }), // protected-omitted
      incomingRow({ cleanUrl: "https://priced-b.com/", originalUrl: "https://priced-b.com", clientPrice: "800" }), // both priced -> flagged
      incomingRow({ cleanUrl: "https://unpriced-c.com/", originalUrl: "https://unpriced-c.com" }), // unprotected -> eligible
      incomingRow({ cleanUrl: "https://new-d.com/", originalUrl: "https://new-d.com" }), // no match -> eligible
    ]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.protectedOmittedRows).toHaveLength(1);
    expect(result.flaggedForManualReviewRows).toHaveLength(1);
    expect(result.eligibleRows).toHaveLength(2);
    expect(result.eligibleRows.map((r) => r[ORIGINAL_URL])).toEqual(["https://unpriced-c.com", "https://new-d.com"]);
    expect(result.protectedDestinationWebsiteCount).toBe(2); // priced-a and priced-b, not unpriced-c
  });

  it("6: when the destination has no detectable URL/domain column, protection cannot be applied -- falls back honestly to ALL incoming rows unchanged, never a guess", () => {
    const destination: Extract<DestinationReadOutcome, { status: "ok" }> = {
      status: "ok",
      destinationId: "dest-2",
      destinationName: "No URL Column Sheet",
      headers: ["Notes", "Comments"],
      rows: [["hello", "world"]],
      rowsRead: 1,
      pricingColumnsDetected: [],
    };
    const incoming = schema([incomingRow({ cleanUrl: "https://a.com/", originalUrl: "https://a.com" })]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.applied).toBe(false);
    expect(result.eligibleRows).toEqual(incoming.rows);
    expect(result.protectedOmittedRows).toHaveLength(0);
  });

  it("7: traffic-classification data stays intact on eligible rows -- protection filters WHICH rows proceed, never their own traffic/URL/price values", () => {
    const destination = destinationOk([]);
    const incoming = schema([
      incomingRow({ cleanUrl: "https://high.com/", originalUrl: "https://high.com", traffic: "42000" }),
      incomingRow({ cleanUrl: "https://low.com/", originalUrl: "https://low.com", traffic: "500" }),
    ]);

    const result = applyDestinationProtection(incoming, destination);

    expect(result.eligibleRows).toHaveLength(2);
    expect(result.eligibleRows.find((r) => r[ORIGINAL_URL] === "https://high.com")?.[ORGANIC_TRAFFIC]).toBe("42000");
    expect(result.eligibleRows.find((r) => r[ORIGINAL_URL] === "https://low.com")?.[ORGANIC_TRAFFIC]).toBe("500");
  });
});
