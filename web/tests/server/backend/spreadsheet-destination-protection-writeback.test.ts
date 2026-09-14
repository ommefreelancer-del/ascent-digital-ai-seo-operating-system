// DESTINATION-PROTECTION DUPLICATE RESOLUTION -- WRITE-TIME INTEGRATION (2026-09-18): a real, live-
// confirmed production defect -- writeApprovedCleaningToGoogleSheets() used to re-derive the business
// schema/traffic split fresh from the approved snapshot with NO awareness of the destination's own existing
// content, so an incoming record that duplicated an already-priced destination record could still be
// appended even after a proposal claimed it would be protected. This proves the real write path now
// actually consults the destination before deciding what to send.
//
// Real DB, mocked network (appendSpreadsheetValues/ensureSheetExists/assertSheetsWriteScope, plus
// getWriteDestinationSpreadsheet/getAllSpreadsheetValues/listSpreadsheets so no real GoogleServiceConnection
// row or live Drive/Sheets call is needed) -- zero real network calls, zero live Google Sheets/Drive calls,
// zero paid API calls.

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";
import type { CleaningResult } from "../../../src/server/backend/spreadsheet-cleaning";
import { createPendingCleaningApproval, approveCleaningApproval } from "../../../src/server/backend/spreadsheet-cleaning-approval";
import { FINAL_BUSINESS_SCHEMA_COLUMNS, CLIENT_WEBSITES_SHEET_NAME, ADMIN_VENDOR_SHEET_NAME } from "../../../src/server/backend/spreadsheet-business-schema";

const appendSpreadsheetValuesMock = vi.fn();
const ensureSheetExistsMock = vi.fn().mockResolvedValue(undefined);
const assertSheetsWriteScopeMock = vi.fn().mockResolvedValue(undefined);
const getWriteDestinationSpreadsheetMock = vi.fn();
const getAllSpreadsheetValuesMock = vi.fn();
const listSpreadsheetsMock = vi.fn();

vi.mock("@/server/google-sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/google-sheets")>();
  return {
    ...actual,
    appendSpreadsheetValues: (...args: unknown[]) => appendSpreadsheetValuesMock(...args),
    ensureSheetExists: (...args: unknown[]) => ensureSheetExistsMock(...args),
    assertSheetsWriteScope: (...args: unknown[]) => assertSheetsWriteScopeMock(...args),
    getWriteDestinationSpreadsheet: (...args: unknown[]) => getWriteDestinationSpreadsheetMock(...args),
    getAllSpreadsheetValues: (...args: unknown[]) => getAllSpreadsheetValuesMock(...args),
    listSpreadsheets: (...args: unknown[]) => listSpreadsheetsMock(...args),
  };
});

const { writeApprovedCleaningToGoogleSheets } = await import("../../../src/server/backend/spreadsheet-google-sheets-writeback");

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

afterEach(async () => {
  appendSpreadsheetValuesMock.mockReset();
  ensureSheetExistsMock.mockReset();
  ensureSheetExistsMock.mockResolvedValue(undefined);
  assertSheetsWriteScopeMock.mockReset();
  assertSheetsWriteScopeMock.mockResolvedValue(undefined);
  getWriteDestinationSpreadsheetMock.mockReset();
  getAllSpreadsheetValuesMock.mockReset();
  listSpreadsheetsMock.mockReset();
  for (const id of createdAttachmentIds.splice(0)) {
    await db.spreadsheetCleaningApproval.deleteMany({ where: { attachmentId: id } }).catch(() => undefined);
    await db.attachment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds.splice(0)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

async function createTestUser(): Promise<string> {
  const user = await db.user.create({ data: { name: "Destination Protection Writeback Test User", email: `dest-protect-wb-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

async function createTestAttachment(userId: string): Promise<string> {
  const attachment = await db.attachment.create({
    data: { userId, originalFileName: "health-master.xlsx", fileType: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 1234, storagePath: "irrelevant.xlsx" },
  });
  createdAttachmentIds.push(attachment.id);
  return attachment.id;
}

// Three incoming Health-Master-sourced records: one duplicates an existing PRICED destination record
// (must be omitted), one is genuinely new (must be written), one duplicates an existing UNPRICED
// destination record (must proceed normally -- not protected).
const INCOMING_RESULT: CleaningResult = {
  headers: ["Website", "Organic Traffic"],
  originalRowCount: 3,
  urlColumnIndex: 0,
  exactDuplicateGroups: [],
  domainDuplicateGroups: [],
  malformedUrlRows: [],
  incompleteRows: [],
  retainedRowIndexes: [0, 1, 2],
  retainedRows: [
    ["https://already-priced.com", "5000"], // duplicates a priced destination record -> must be omitted
    ["https://brand-new-prospect.com", "6000"], // genuinely new -> must be written
    ["https://unpriced-existing.com", "700"], // duplicates an UNPRICED destination record -> proceeds normally
  ],
  manualReviewRowIndexes: [],
};

describe("writeApprovedCleaningToGoogleSheets -- destination protection is actually applied at write time", () => {
  it("1/2/6: an existing PRICED destination record is never touched, and the incoming duplicate of it is OMITTED from the real write", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-sheet-1", name: "Admin Sheet Health" });
    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "dest-sheet-1") {
        return Promise.resolve({
          values: [
            ["Website", "Admin Price", "Deal Status"],
            ["https://already-priced.com", "500", "done"],
            ["https://unpriced-existing.com", "", ""],
          ],
          rowsRead: 2,
          batchesRead: 1,
          cappedAtSafetyLimit: false,
        });
      }
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);

    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    const pending = await createPendingCleaningApproval(userId, attachmentId, INCOMING_RESULT);
    const approved = await approveCleaningApproval(userId, pending.id);

    const result = await writeApprovedCleaningToGoogleSheets(userId, approved.record!, "dest-sheet-1");

    expect(result.ok).toBe(true);
    expect(result.protectedOmittedCount).toBe(1);
    expect(result.flaggedForManualReviewCount).toBe(0);

    // 7: the genuinely new AND the unpriced-destination-duplicate records were both written (2 total) --
    // the protected duplicate of the priced record was not.
    const writtenCalls = appendSpreadsheetValuesMock.mock.calls;
    const allWrittenUrls = writtenCalls.flatMap((call) => (call[3] as string[][]).slice(1).map((row) => row[FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL")]));
    expect(allWrittenUrls).toContain("https://brand-new-prospect.com");
    expect(allWrittenUrls).toContain("https://unpriced-existing.com");
    expect(allWrittenUrls).not.toContain("https://already-priced.com");
  });

  it("3/4: when BOTH the existing destination record and the incoming record are priced, the incoming one is held back (not written) and flagged -- neither auto-written nor auto-deleted", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-sheet-2", name: "Admin Sheet Health" });
    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "dest-sheet-2") {
        return Promise.resolve({ values: [["Website", "Admin Price"], ["https://already-priced.com", "500"]], rowsRead: 1, batchesRead: 1, cappedAtSafetyLimit: false });
      }
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);

    const bothPricedResult: CleaningResult = {
      ...INCOMING_RESULT,
      headers: ["Website", "Organic Traffic", "Admin Price"],
      retainedRows: [["https://already-priced.com", "5000", "900"]],
      originalRowCount: 1,
      retainedRowIndexes: [0],
    };

    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    const pending = await createPendingCleaningApproval(userId, attachmentId, bothPricedResult);
    const approved = await approveCleaningApproval(userId, pending.id);

    const result = await writeApprovedCleaningToGoogleSheets(userId, approved.record!, "dest-sheet-2");

    expect(result.ok).toBe(true);
    expect(result.flaggedForManualReviewCount).toBe(1);
    expect(result.protectedOmittedCount).toBe(0);
    // Nothing eligible to write at all -- appendSpreadsheetValues is never called for an empty destination.
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("6/8: the traffic-based Admin/Client split still applies correctly to the ELIGIBLE (post-protection) records only", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-sheet-3", name: "Admin Sheet Health" });
    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "dest-sheet-3") {
        return Promise.resolve({ values: [["Website", "Admin Price"], ["https://already-priced.com", "500"]], rowsRead: 1, batchesRead: 1, cappedAtSafetyLimit: false });
      }
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);

    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    const pending = await createPendingCleaningApproval(userId, attachmentId, INCOMING_RESULT);
    const approved = await approveCleaningApproval(userId, pending.id);

    const result = await writeApprovedCleaningToGoogleSheets(userId, approved.record!, "dest-sheet-3");

    expect(result.ok).toBe(true);
    // brand-new-prospect (6000 traffic, >=1000) -> Admin/Vendor; unpriced-existing (700 traffic, <1000) -> Client Sheet.
    expect(result.adminVendorRowCount).toBe(1);
    expect(result.clientWebsiteRowCount).toBe(1);
    expect(ensureSheetExistsMock).toHaveBeenCalledWith(userId, "dest-sheet-3", ADMIN_VENDOR_SHEET_NAME);
    expect(ensureSheetExistsMock).toHaveBeenCalledWith(userId, "dest-sheet-3", CLIENT_WEBSITES_SHEET_NAME);
  });

  it("5: real destination content is genuinely unknown (read failed) -- no protection applied, but the write still proceeds honestly with the full eligible set (never silently blocked by an unrelated read failure)", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-sheet-4", name: "Admin Sheet Health" });
    getAllSpreadsheetValuesMock.mockRejectedValue(new Error("Sheets spreadsheets.values.get failed: 403 Forbidden"));
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);

    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    const pending = await createPendingCleaningApproval(userId, attachmentId, INCOMING_RESULT);
    const approved = await approveCleaningApproval(userId, pending.id);

    const result = await writeApprovedCleaningToGoogleSheets(userId, approved.record!, "dest-sheet-4");

    expect(result.ok).toBe(true);
    expect(result.protectedOmittedCount).toBe(0);
    expect(result.flaggedForManualReviewCount).toBe(0);
    // All 3 incoming records written -- 2 admin-vendor (5000, 6000) + 1 client (700).
    expect((result.adminVendorRowCount ?? 0) + (result.clientWebsiteRowCount ?? 0)).toBe(3);
  });
});

describe("source-level: the write path never clears/updates/replaces the destination -- append only", () => {
  it("spreadsheet-google-sheets-writeback.ts only calls appendSpreadsheetValues to write -- no values.clear/values.update/batchUpdate call anywhere", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.resolve(__dirname, "../../../src/server/backend/spreadsheet-google-sheets-writeback.ts"), "utf8");
    expect(source).not.toMatch(/values\.clear|values\.update|batchUpdate|clearSpreadsheetValues|deleteSheet\b/);
    expect(source).toContain("appendSpreadsheetValues(");
  });
});
