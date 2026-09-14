// DESTINATION-PROTECTION REPORTING TRACE (2026-09-19): traces processSelectedGoogleSheet()'s ACTUAL reply
// text end to end for the exact reported scenario -- source "Health Master Sheet", configured destination
// "Admin Sheet Health", with an incoming source record duplicating an already-priced destination record --
// to empirically verify (via fixtures, no live calls) whether the destination-protection evidence
// (destination name, "protected"/"destination" language, omitted/flagged counts) actually reaches the
// generated proposal text, or whether a real reporting defect exists despite applyDestinationProtection()
// itself being correct in isolation (see spreadsheet-destination-protection.test.ts). Written specifically
// because no PRIOR test asserted this exact end-to-end text for processSelectedGoogleSheet() -- the
// existing google-sheets-destination-selection.test.ts's "when a destination IS configured" case predates
// destination protection (6b40525) and only asserts pre-protection report lines, so it could not have
// caught a regression in the protection-reporting text specifically.
//
// Real DB, real filesystem artifact writes (same convention as google-sheets-cleaning.test.ts) -- only
// @/server/google-sheets is mocked. Zero real network calls, zero live Google Drive/Sheets calls, zero
// paid API calls.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";

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

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

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
  const user = await db.user.create({ data: { name: "Destination Protection Report Test User", email: `dest-protect-report-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

describe("processSelectedGoogleSheet -- destination-protection evidence in the ACTUAL generated proposal text", () => {
  it("reports the configured destination name, 'protected'/'destination' language, and accurate omitted/flagged counts for the exact reported scenario (Health Master -> Admin Sheet Health)", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "admin-sheet-health-id", name: "Admin Sheet Health" });

    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "health-master-id") {
        return Promise.resolve({
          values: [
            ["URL", "Domain Search Traffic (ST)"],
            ["https://already-priced-prospect.com", "5000"], // duplicates an existing priced Admin Sheet Health record
            ["https://brand-new-prospect.com", "6000"], // genuinely new
          ],
          rowsRead: 2,
          batchesRead: 1,
          cappedAtSafetyLimit: false,
        });
      }
      if (spreadsheetId === "admin-sheet-health-id") {
        return Promise.resolve({
          values: [
            ["Website", "Admin Price", "Deal Status"],
            ["https://already-priced-prospect.com", "500", "done"],
          ],
          rowsRead: 1,
          batchesRead: 1,
          cappedAtSafetyLimit: false,
        });
      }
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });

    const userId = await createTestUser();
    const result = await processSelectedGoogleSheet(userId);

    expect(result.ok).toBe(true);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);

    const reply = result.reply!;

    // Exact words the reported live proposal was missing.
    expect(reply).toContain("Admin Sheet Health");
    expect(reply.toLowerCase()).toContain("destination");
    expect(reply.toLowerCase()).toContain("protected");

    // Specific, accurate protection evidence.
    expect(reply).toContain('Configured write destination: "Admin Sheet Health"');
    expect(reply).toContain("Destination protection APPLIED");
    expect(reply).toMatch(/1 incoming Health Master duplicate\(s\) of an already-priced destination record were OMITTED/);
    expect(reply).toMatch(/0 incoming record\(s\) duplicate an already-priced destination record AND are themselves priced/);
    expect(reply).toContain("Existing destination records are never cleared, truncated, replaced, or overwritten");

    // Never references the unrelated "Deal Done With Admin Sheet" name.
    expect(reply).not.toContain("Deal Done With Admin");
    expect(reply).not.toContain("DEAL DONE WITH ADMIN");
  });
});
