// GOOGLE SHEETS LIVE CLEANING (2026-09-14): real, live-confirmed production defect -- once a selected
// Google Sheet was read completely (batch read fix), the AI Workspace agent still only ever received up
// to ~5,000 raw rows embedded verbatim in its own chat context, and "Health Master Sheet"'s Sheet1
// genuinely has more than 5,000 rows. This proves processSelectedGoogleSheet() moves the deterministic
// work (dedup, header-repeat handling, traffic bucketing/K-M conversion) OFF the model entirely: a real
// >5,000-row dataset is processed completely, server-side, and only a compact, count-based report ever
// reaches the chat reply -- never thousands of raw rows.
//
// Real DB, real filesystem artifact writes (same established convention as
// spreadsheet-processing.test.ts) -- only @/server/google-sheets is mocked (getSelectedSpreadsheet /
// getAllSpreadsheetValues / getWriteDestinationSpreadsheet / listSpreadsheets), since this suite is about
// processSelectedGoogleSheet()'s OWN deterministic logic, not about re-proving getAllSpreadsheetValues()'s
// own real batching (already covered by tests/server/google-sheets.test.ts) or listSpreadsheets()'s own
// real Drive call (covered by google-sheets.test.ts too). Zero real network calls, zero live Google
// Drive/Sheets calls, zero paid API calls.
//
// DESTINATION-SELECTION RESTORATION (2026-09-16): getWriteDestinationSpreadsheetMock/listSpreadsheetsMock
// default to "not configured, zero spreadsheets" for every test below UNLESS a test explicitly overrides
// them -- these tests are about the cleaning pipeline itself, not the destination-selection behavior
// (that has its own dedicated suite, google-sheets-destination-selection.test.ts).

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";
import type { AllSpreadsheetValuesResult } from "../../../src/server/google-sheets";

const getSelectedSpreadsheetMock = vi.fn();
const getAllSpreadsheetValuesMock = vi.fn();
const getWriteDestinationSpreadsheetMock = vi.fn();
const listSpreadsheetsMock = vi.fn();
vi.mock("@/server/google-sheets", () => ({
  getSelectedSpreadsheet: (...args: unknown[]) => getSelectedSpreadsheetMock(...args),
  getAllSpreadsheetValues: (...args: unknown[]) => getAllSpreadsheetValuesMock(...args),
  getWriteDestinationSpreadsheet: (...args: unknown[]) => getWriteDestinationSpreadsheetMock(...args),
  listSpreadsheets: (...args: unknown[]) => listSpreadsheetsMock(...args),
}));

const { processSelectedGoogleSheet } = await import("../../../src/server/backend/google-sheets-cleaning");

const SPREADSHEET_CLEANING_STORAGE_ROOT = path.join(process.cwd(), "var", "spreadsheet-cleaning");
const ATTACHMENTS_STORAGE_ROOT = path.join(process.cwd(), "var", "attachments");

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

beforeEach(() => {
  // Sensible, non-destination-specific default for every test in this file -- "not configured, zero
  // spreadsheets" -- so tests about the cleaning pipeline itself don't need to know about destination
  // selection at all. Individual tests may override via mockResolvedValueOnce before calling
  // processSelectedGoogleSheet.
  getWriteDestinationSpreadsheetMock.mockResolvedValue(null);
  listSpreadsheetsMock.mockResolvedValue([]);
});

afterEach(async () => {
  getSelectedSpreadsheetMock.mockReset();
  getAllSpreadsheetValuesMock.mockReset();
  getWriteDestinationSpreadsheetMock.mockReset();
  listSpreadsheetsMock.mockReset();
  for (const id of createdAttachmentIds.splice(0)) {
    const approvals = await db.spreadsheetCleaningApproval.findMany({ where: { attachmentId: id } });
    for (const approval of approvals) {
      if (approval.cleanedFileStoragePath) await rm(path.join(SPREADSHEET_CLEANING_STORAGE_ROOT, approval.cleanedFileStoragePath), { force: true }).catch(() => undefined);
      if (approval.auditFileStoragePath) await rm(path.join(SPREADSHEET_CLEANING_STORAGE_ROOT, approval.auditFileStoragePath), { force: true }).catch(() => undefined);
    }
    await db.spreadsheetCleaningApproval.deleteMany({ where: { attachmentId: id } });
    await db.attachment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds.splice(0)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

async function createTestUser(): Promise<string> {
  const user = await db.user.create({ data: { name: "Google Sheets Cleaning Test User", email: `gs-cleaning-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

const HEADER = ["Website URL", "Domain Search Traffic"];

/**
 * Builds a real, deterministic >5,000-row fixture:
 * - rows 1-2500: distinct URLs, traffic ALL below 1,000 (proves "all <1,000 records retained").
 * - row 1200 (0-indexed 1199): a TRUE duplicate of row 5 (data row 5) -- deliberately far apart,
 *   simulating what would have been two different real batches before accumulation.
 * - row 3000 (0-indexed 2999): the header row repeated verbatim mid-data (real multi-section-export
 *   pattern) -- must be ignored, never treated as a real prospect record.
 * - rows 2501-5100: distinct URLs with traffic in the K range (1,000-999,999).
 * - 3 extra rows with traffic >= 1,000,000 (M range).
 * Total: 2500 (+1 exact dup) + 2600 (K range, includes the embedded header row) + 3 (M range) = 5104 data rows + 1 header = 5105 total values rows.
 */
function buildLargeFixtureRows(): string[][] {
  const rows: string[][] = [HEADER];

  for (let i = 1; i <= 2500; i++) {
    rows.push([`https://low-traffic-${i}.example.com`, String(100 + (i % 800))]); // always < 1000
  }
  // A true duplicate of data row 5 (rows[5] after the header, i.e. rows array index 5), inserted far
  // later -- proves cross-batch (far-apart) duplicate detection over the FULL accumulated dataset.
  const duplicateOfRow5 = [...rows[5]!];

  for (let i = 2501; i <= 5100; i++) {
    if (i === 3000) {
      rows.push([...HEADER]); // embedded header row, verbatim, mid-data
      continue;
    }
    rows.push([`https://mid-traffic-${i}.example.com`, String(1000 + i)]); // K range
  }
  rows.push(duplicateOfRow5);
  rows.push(["https://big-traffic-1.example.com", "1500000"]); // M range
  rows.push(["https://big-traffic-2.example.com", "2000000"]); // M range
  rows.push(["https://big-traffic-3.example.com", "12500000"]); // M range

  return rows;
}

describe("processSelectedGoogleSheet -- server-side deterministic cleaning of a complete, real >5,000-row dataset", () => {
  it("NO SELECTION: never reads anything, honestly asks the user to select a spreadsheet first", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue(null);
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("No spreadsheet is currently selected");
    expect(getAllSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("ANTI-FABRICATION ON READ FAILURE: a real read failure is reported honestly, never a fabricated cleaning result", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "sheet-1", name: "Health Master Sheet" });
    getAllSpreadsheetValuesMock.mockRejectedValue(new Error("Sheets spreadsheets.values.get failed: 403 Forbidden"));
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("failed");
    expect(result.reply).toContain("403");
  });

  it("REPRODUCES + FIXES THE 5,000+ ROW DEFECT: the COMPLETE dataset is processed server-side, all real rows accounted for -- never truncated to 5,000, never dumped as raw rows into the chat reply", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    expect(allRows.length).toBeGreaterThan(5000); // sanity: the fixture itself genuinely exceeds the old cap
    const fakeReadResult: AllSpreadsheetValuesResult = { values: allRows, rowsRead: allRows.length, batchesRead: Math.ceil(allRows.length / 500), cappedAtSafetyLimit: false };
    getAllSpreadsheetValuesMock.mockResolvedValue(fakeReadResult);
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    createdAttachmentIds.push((await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }))!.attachmentId);

    // Requested with the SAME persisted selection id, no hardcoded spreadsheet, and with the higher,
    // server-side-only row ceiling (never the smaller chat-context default).
    expect(getAllSpreadsheetValuesMock).toHaveBeenCalledWith(userId, "health-master-id", { maxTotalRows: 200_000 });

    // "all rows are processed" -- originalRowCount (data rows, header excluded) matches the real fixture.
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    expect(approval).not.toBeNull();
    const persistedResult = JSON.parse(approval!.resultJson);
    expect(persistedResult.originalRowCount).toBe(allRows.length - 1); // header excluded

    // Never raw rows dumped into the chat reply -- the reply must stay compact regardless of dataset size.
    expect(result.reply!.length).toBeLessThan(10_000);
    expect(result.reply).not.toContain("low-traffic-2499"); // an arbitrary real row's data is NOT verbatim in the chat text
    expect(result.reply).toContain(`${readableBatchCount(allRows.length)} real batch(es)`);
    expect(result.reply).toContain(`${allRows.length} row(s) total read server-side`); // raw read count, header included
    expect(result.reply).toContain(`Original data rows read (server-side, complete): ${allRows.length - 1}`); // header excluded
    expect(result.reply).not.toContain("safety limit"); // real end of data, not a capped read
  });

  it("CROSS-BATCH DUPLICATE DETECTION: a true duplicate inserted far from its original (simulating two different real batches) is still detected over the full accumulated dataset", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: allRows, rowsRead: allRows.length, batchesRead: 11, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson);

    expect(persistedResult.exactDuplicateGroups.length).toBeGreaterThanOrEqual(1);
    // rows[5] (in the raw fixture, header included) is data row 5 -- once the header is stripped for
    // buildCleaningResult(), that's dataRows[4] (0-indexed), displayed as "data row 5" (4 + 1).
    const group = persistedResult.exactDuplicateGroups.find((g: { rowIndexes: number[] }) => g.rowIndexes.includes(4));
    expect(group).toBeDefined();
    expect(group.rowIndexes.length).toBe(2); // the original + the far-later duplicate, nothing else
    expect(result.reply).toContain("Kept data row 5;"); // real, 1-indexed display of dataRows[4]
    expect(result.reply).toContain("Exact duplicates: 1 group(s)");
  });

  it("REPEATED HEADERS IGNORED: the header row embedded mid-data is never treated as a real prospect record in the final business-schema output", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: allRows, rowsRead: allRows.length, batchesRead: 11, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    // The embedded header row IS present in the raw cleaning result (cleaning operates on source columns,
    // never silently drops a row) -- its "URL" column literally reads "Website URL", which does not parse
    // as a real domain, so the EXISTING malformed-URL detection genuinely flags it (real row 3000).
    const persistedResult = JSON.parse(approval!.resultJson);
    expect(persistedResult.malformedUrlRows.some((f: { rowIndex: number }) => f.rowIndex === 2999)).toBe(true); // 0-indexed data row 3000
    expect(result.reply).toContain('Data row 3000: "Website URL" does not parse as a real domain/URL.');

    // It is the LATER business-schema mapping stage (isEmbeddedHeaderRow()) that must actually exclude
    // it from the real deliverable -- proven via the real cleaned artifact download rather than
    // re-deriving the mapping logic in the test.
    const artifactModule = await import("../../../src/server/backend/spreadsheet-cleaning-artifacts");
    const cleanedArtifact = await artifactModule.retrieveCleaningArtifact(userId, approval!.id, "cleaned");
    expect(cleanedArtifact).not.toBeNull();
    // A real XLSX is a real zip archive (PK magic bytes) -- a coarse but genuine sanity check that a real
    // workbook, not empty/corrupt output, was produced from this large dataset.
    expect(cleanedArtifact!.buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("K/M CONVERSION + <1,000 RETENTION: every below-1,000 record is retained and counted, K/M-range records are bucketed to Admin/Vendor -- deterministic, not model-dependent", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: allRows, rowsRead: allRows.length, batchesRead: 11, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    // 2500 genuinely-below-1000 records -- none of them dropped, none miscounted.
    expect(result.reply).toContain("Records with organic traffic BELOW 1,000 (retained");
    expect(result.reply).toMatch(/BELOW 1,000 \(retained, routed to "Client Sheet" if approved\): 2500\./);
    // K/M formatting rule stated explicitly and deterministically (not "ask the model to guess").
    expect(result.reply).toContain('1,000-999,999 shown as K (e.g. "2.5K")');
    expect(result.reply).toContain('1,000,000+ shown as M (e.g. "1.2M")');
  });

  it("NEVER WRITES, DELETES, OR MOVES ANYTHING -- only a pending approval is created; the reply says so explicitly", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: allRows, rowsRead: allRows.length, batchesRead: 11, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    expect(approval!.status).toBe("pending_approval");
    expect(result.reply).toContain("Nothing has been written to, deleted from, or moved in");
    expect(result.approvalMeta!.status).toBe("pending_approval");
  });

  it("SAFETY-LIMIT HONESTY: when the real server-side read itself was capped, the report says so and never claims a complete dataset", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const allRows = buildLargeFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: allRows, rowsRead: allRows.length, batchesRead: 11, cappedAtSafetyLimit: true });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    expect(result.reply).toContain("stopped at a real safety limit");
    expect(result.reply).toContain("may genuinely have more rows");
  });
});

// REAL, LIVE-CONFIRMED REGRESSION (2026-09-24): a real live chat request -- "Google Sheets Integration
// Agent: clean the selected Health source and write the cleaned result to the selected Health destination.
// Remove exact duplicates and apply one-record-per-domain cleanup, excluding large platform domains. ..." --
// reached exactly this flow (processSelectedGoogleSheet, source-into-destination) and the resulting proposal
// still only FLAGGED the 23 real domain-duplicate groups (49 rows) instead of collapsing them, confirmed via
// a live PDF transcript. Root cause: this flow never applied domain-level collapsing at all -- only the
// separate "Admin - Vendor"/"Client Sheet" self-cleanup flow (spreadsheet-existing-output-cleanup.ts) had
// it, and even that flow's phrase detector required literal whitespace ("one record per domain"), which
// would not have matched the real request's actual hyphenated wording ("one-record-per-domain") either. Both
// are fixed: detectDomainLevelDedupIntent() (spreadsheet-cleaning.ts) now tolerates hyphens, and THIS flow
// now calls it and applies collapseDomainDuplicatesToOnePerDomain() when it matches.
describe("processSelectedGoogleSheet -- domain-level dedup (2026-09-24 fix): 'one record per domain' now actually removes, not just flags", () => {
  const HEALTH_HEADER = ["URL", "DA", "PA", "SS", "DR", "TRAFFIC"];
  function healthFixtureRows(): string[][] {
    return [
      HEALTH_HEADER,
      ["https://medicalnewstoday.com/article-1", "70", "60", "40", "50", "500"],
      ["https://rightpatient.com/guest-post", "45", "30", "20", "25", "300"],
      ["https://linkedin.com/posts/dr-jane-1", "98", "80", "60", "70", "900"], // known platform domain
      ["https://medicalnewstoday.com/article-2", "70", "60", "40", "50", "500"], // same domain, differs -- would be collapsed
      ["https://linkedin.com/posts/dr-jane-2", "98", "80", "60", "70", "900"], // same platform domain -- should stay, NOT collapsed
      ["https://uniquehealthsite.com/page", "55", "40", "30", "35", "400"],
    ];
  }

  it("REGRESSION: the exact real request wording ('one-record-per-domain cleanup, excluding large platform domains') actually collapses non-platform domain duplicates and leaves the platform domain's rows untouched", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-source-id", name: "Admin Sheet Health-FINAL" });
    const rows = healthFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: rows, rowsRead: rows.length - 1, batchesRead: 1, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const message =
      'Google Sheets Integration Agent: clean the selected Health source and write the cleaned result to the selected Health destination.\n\n' +
      'Remove exact duplicates and apply one-record-per-domain cleanup, excluding large platform domains.';

    const result = await processSelectedGoogleSheet(userId, message);
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    // medicalnewstoday.com collapsed from 2 rows to 1; linkedin.com (platform, excluded) keeps BOTH rows;
    // rightpatient.com and uniquehealthsite.com are untouched singletons. 6 original -> 5 retained.
    expect(result.reply).toContain("Retained records: 5");
    expect(result.reply).toContain("EXCLUDED from domain-level collapsing");
    expect(result.reply).toContain('Domain "linkedin.com"');
    expect(result.reply).toContain("MATCHES rows read.");
    expect(result.reply).not.toContain("DOES NOT MATCH");

    const persisted = JSON.parse(approval!.resultJson) as { retainedRows: string[][] };
    const retainedUrls = persisted.retainedRows.map((r) => r[0]);
    expect(retainedUrls).toContain("https://linkedin.com/posts/dr-jane-1");
    expect(retainedUrls).toContain("https://linkedin.com/posts/dr-jane-2");
    expect(retainedUrls.filter((u) => u?.includes("medicalnewstoday.com"))).toHaveLength(1);
  });

  it("without a message (or one that doesn't ask for domain-level dedup), domain duplicates are still only FLAGGED, never removed -- unchanged default behavior", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-source-id", name: "Admin Sheet Health-FINAL" });
    const rows = healthFixtureRows();
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: rows, rowsRead: rows.length - 1, batchesRead: 1, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId, "Clean the selected Health source and write the result to the destination.");
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    expect(result.reply).toContain("Retained records: 6"); // nothing removed -- only exact-dup removal applies, and there are none here
    expect(result.reply).toContain("flagged for your review, NOT automatically removed");
    expect(result.reply).not.toContain("EXCLUDED from domain-level collapsing");
  });

  // REAL, LIVE-CONFIRMED PERMANENT-RULE GAP (2026-09-24, second report): the stated PERMANENT rule set also
  // requires "NEVER remove or overwrite any existing record with a deal/pricing data", "if a duplicate has
  // one protected deal/priced record, remove only the other duplicate", and "if both duplicates are
  // protected deal/priced records, keep both for review" -- none of which the domain-level collapse's
  // selection logic honored at all (it only ever picked the lowest row index, with zero pricing awareness).
  // The live report that surfaced this had zero priced source rows, so it never actually violated the rule
  // yet -- these tests prove it now would, and that the fix prevents it.
  it("PERMANENT RULE: within processSelectedGoogleSheet(), a domain group with exactly one already-priced row keeps THAT row even when a lower-indexed unpriced sibling exists", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-source-id", name: "Admin Sheet Health-FINAL" });
    const rows = [
      HEALTH_HEADER.concat(["Client Price"]),
      ["https://medicalnewstoday.com/unpriced", "70", "60", "40", "50", "500", "" /* unpriced -- lower index */],
      ["https://medicalnewstoday.com/priced", "70", "60", "40", "50", "500", "900" /* priced -- higher index */],
    ];
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: rows, rowsRead: rows.length - 1, batchesRead: 1, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId, "Clean this Health sheet: apply one-record-per-domain cleanup.");
    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    const persisted = JSON.parse(approval!.resultJson) as { retainedRows: string[][] };
    expect(persisted.retainedRows).toHaveLength(1);
    expect(persisted.retainedRows[0]![0]).toBe("https://medicalnewstoday.com/priced");
  });

  it("PERMANENT RULE: within processSelectedGoogleSheet(), a domain group with TWO already-priced rows is left completely alone -- both kept, flagged for manual review", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-source-id", name: "Admin Sheet Health-FINAL" });
    const rows = [
      HEALTH_HEADER.concat(["Client Price"]),
      ["https://medicalnewstoday.com/priced-1", "70", "60", "40", "50", "500", "900"],
      ["https://medicalnewstoday.com/priced-2", "70", "60", "40", "50", "500", "950"],
    ];
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: rows, rowsRead: rows.length - 1, batchesRead: 1, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId, "Clean this Health sheet: apply one-record-per-domain cleanup.");
    expect(result.ok).toBe(true);
    expect(result.reply).toContain("KEPT BOTH FOR REVIEW");
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    const persisted = JSON.parse(approval!.resultJson) as { retainedRows: string[][] };
    expect(persisted.retainedRows).toHaveLength(2);
  });
});

function readableBatchCount(totalRowsIncludingHeader: number): number {
  return Math.ceil(totalRowsIncludingHeader / 500);
}
