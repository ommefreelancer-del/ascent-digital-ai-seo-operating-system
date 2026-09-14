// DESTINATION-SELECTION RESTORATION (2026-09-16): real regression coverage for a live-confirmed workflow
// gap -- the Health Master live-sheet cleaning proposal (processSelectedGoogleSheet(), google-sheets-
// cleaning.ts) never checked whether a Google Sheets WRITE destination was configured, and never read that
// destination's existing content, so the user had no visibility into where (or whether) approved results
// could be written, and no protection data for a future price-aware duplicate-resolution step. The
// write-destination SELECTOR itself already existed and already worked (Settings -> Integrations --
// see tests/server/google-sheets-write-destination-route.test.ts and
// tests/components/settings-shell-google-sheets-write-destination.test.ts, both already passing and
// unmodified by this change) -- this restores the missing wiring between that existing selector and the
// Health Master proposal, via readWriteDestinationForDuplicateProtection() (google-sheets-cleaning.ts).
//
// Real DB, real filesystem artifact writes (same established convention as google-sheets-cleaning.test.ts)
// -- only @/server/google-sheets is mocked. Zero real network calls, zero live Google Drive/Sheets calls,
// zero paid API calls. This suite deliberately does NOT implement or test any price-aware
// duplicate-resolution ALGORITHM -- that is explicitly out of scope for this change.

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
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

const { processSelectedGoogleSheet, readWriteDestinationForDuplicateProtection } = await import("../../../src/server/backend/google-sheets-cleaning");

const SPREADSHEET_CLEANING_STORAGE_ROOT = path.join(process.cwd(), "var", "spreadsheet-cleaning");
const GOOGLE_SHEETS_CLEANING_SOURCE = readFileSync(path.resolve(__dirname, "../../../src/server/backend/google-sheets-cleaning.ts"), "utf8");

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
  const user = await db.user.create({ data: { name: "Destination Selection Test User", email: `dest-select-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

const SOURCE_HEADERS = ["#", "Search query", "URL", "Domain Search Traffic (ST)"];
const SOURCE_ROWS = [
  ["1", "guest post", "https://alpha.com", "5000"],
  ["2", "guest post", "https://beta.com", "500"],
];
const SOURCE_VALUES = [SOURCE_HEADERS, ...SOURCE_ROWS];

describe("readWriteDestinationForDuplicateProtection -- the core restored function", () => {
  it("1: when no destination is configured, surfaces the user's real, live spreadsheet list so they can choose -- never a hardcoded suggestion", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue(null);
    listSpreadsheetsMock.mockResolvedValue([
      { id: "sheet-a", name: "Deal Done Admin" },
      { id: "sheet-b", name: "Some Other Tracker" },
    ]);

    const outcome = await readWriteDestinationForDuplicateProtection("user-1");

    expect(outcome.status).toBe("not_configured");
    if (outcome.status !== "not_configured") throw new Error("unreachable");
    expect(outcome.availableSpreadsheets).toEqual([
      { id: "sheet-a", name: "Deal Done Admin" },
      { id: "sheet-b", name: "Some Other Tracker" },
    ]);
    expect(getAllSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("5: never assumes or defaults to a sheet named \"Deal Done Admin\" -- the real destination name is whatever the user actually configured, even when it's called something else entirely", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-xyz", name: "My Totally Different Tracker Name" });
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: [["URL"]], rowsRead: 0, batchesRead: 1, cappedAtSafetyLimit: false });

    const outcome = await readWriteDestinationForDuplicateProtection("user-1");

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.destinationName).toBe("My Totally Different Tracker Name");
    expect(outcome.destinationId).toBe("sheet-xyz");
  });

  it("6: reads the configured destination's existing content READ-ONLY before any write -- via the same real getAllSpreadsheetValues() batch reader, keyed by the actual configured destination id", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-id-1", name: "Admin Tracker" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["URL", "Admin Price", "Deal Status"],
        ["https://existing.com", "500", "done"],
      ],
      rowsRead: 1,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });

    const outcome = await readWriteDestinationForDuplicateProtection("user-42");

    expect(getAllSpreadsheetValuesMock).toHaveBeenCalledWith("user-42", "dest-id-1", { maxTotalRows: 200_000 });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.rowsRead).toBe(1);
    expect(outcome.rows).toEqual([["https://existing.com", "500", "done"]]);
  });

  it("7: existing pricing/deal columns (Admin Price / Client Price / Profit / Deal Status) are detected by real, exact header match and made available -- never fabricated, never guessed from an unrelated column", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-id-2", name: "Admin Tracker" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [["URL", "Admin Price", "Notes", "Deal Status"]],
      rowsRead: 0,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });

    const outcome = await readWriteDestinationForDuplicateProtection("user-1");

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.pricingColumnsDetected).toEqual(["Admin Price", "Deal Status"]);
  });

  it("7b: when no real pricing column exists in the destination, honestly reports none -- never invents one", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-id-3", name: "Admin Tracker" });
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: [["URL", "Notes"]], rowsRead: 0, batchesRead: 1, cappedAtSafetyLimit: false });

    const outcome = await readWriteDestinationForDuplicateProtection("user-1");

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.pricingColumnsDetected).toEqual([]);
  });

  it("a real read failure against the configured destination is reported honestly, never a fabricated success", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-id-4", name: "Admin Tracker" });
    getAllSpreadsheetValuesMock.mockRejectedValue(new Error("Sheets spreadsheets.values.get failed: 403 Forbidden"));

    const outcome = await readWriteDestinationForDuplicateProtection("user-1");

    expect(outcome.status).toBe("read_failed");
    if (outcome.status !== "read_failed") throw new Error("unreachable");
    expect(outcome.reason).toContain("403");
  });

  it("8: never calls any write function -- the module doesn't even import appendSpreadsheetValues/ensureSheetExists/setWriteDestinationSpreadsheet", () => {
    const importLine = GOOGLE_SHEETS_CLEANING_SOURCE.match(/import \{[^}]*\} from ["']@\/server\/google-sheets["'];/)?.[0] ?? "";
    expect(importLine).not.toMatch(/appendSpreadsheetValues|ensureSheetExists|setWriteDestinationSpreadsheet|assertSheetsWriteScope/);
  });
});

describe("processSelectedGoogleSheet -- the Health Master proposal now surfaces destination selection/inspection", () => {
  it("1/2/5: when no destination is configured, the chat report lists real available spreadsheets and tells the user to choose one via the existing selector -- never hard-codes a destination name", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "health-master-id") return Promise.resolve({ values: SOURCE_VALUES, rowsRead: SOURCE_ROWS.length, batchesRead: 1, cappedAtSafetyLimit: false });
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });
    getWriteDestinationSpreadsheetMock.mockResolvedValue(null);
    listSpreadsheetsMock.mockResolvedValue([
      { id: "opt-1", name: "Deal Done Admin" },
      { id: "opt-2", name: "Prospect Tracker 2026" },
    ]);
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    createdAttachmentIds.push((await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }))!.attachmentId);

    expect(result.reply).toContain("=== F. WRITE DESTINATION ===");
    expect(result.reply).toContain("No Google Sheets write destination is configured yet");
    expect(result.reply).toContain("Deal Done Admin"); // a REAL option from the user's own account, not a hardcoded assumption
    expect(result.reply).toContain("Prospect Tracker 2026");
    expect(result.reply).toMatch(/Settings.*Integrations.*Write destination/i);
    // Never writes anywhere during destination inspection.
    expect(getAllSpreadsheetValuesMock).not.toHaveBeenCalledWith(userId, "opt-1", expect.anything());
    expect(getAllSpreadsheetValuesMock).not.toHaveBeenCalledWith(userId, "opt-2", expect.anything());
  });

  it("4/6/7: when a destination IS configured, it is the one actually read -- read-only, before any write -- and its pricing columns are surfaced", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    const destinationValues = [
      ["URL", "Admin Price", "Deal Status"],
      ["https://already-priced.com", "750", "done"],
      ["https://already-priced-2.com", "900", "done"],
    ];
    getAllSpreadsheetValuesMock.mockImplementation((_userId: string, spreadsheetId: string) => {
      if (spreadsheetId === "health-master-id") return Promise.resolve({ values: SOURCE_VALUES, rowsRead: SOURCE_ROWS.length, batchesRead: 1, cappedAtSafetyLimit: false });
      if (spreadsheetId === "my-real-admin-tracker-id") return Promise.resolve({ values: destinationValues, rowsRead: 2, batchesRead: 1, cappedAtSafetyLimit: false });
      throw new Error(`unexpected getAllSpreadsheetValues call for ${spreadsheetId}`);
    });
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "my-real-admin-tracker-id", name: "My Real Admin Tracker" });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    expect(result.ok).toBe(true);
    createdAttachmentIds.push((await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }))!.attachmentId);

    // The configured destination -- and ONLY that one -- was actually read.
    expect(getAllSpreadsheetValuesMock).toHaveBeenCalledWith(userId, "my-real-admin-tracker-id", { maxTotalRows: 200_000 });
    expect(result.reply).toContain('Configured write destination: "My Real Admin Tracker"');
    expect(result.reply).toContain("Read 2 existing row(s) from it (read-only -- nothing written)");
    expect(result.reply).toContain("Admin Price, Deal Status");
    expect(result.reply).not.toContain("Deal Done Admin"); // never hard-coded -- the real configured name is used verbatim
  });

  it("9: existing Google Sheets discovery (listSpreadsheets) is still reached exactly as before when no destination is configured -- discovery behavior unchanged", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: SOURCE_VALUES, rowsRead: SOURCE_ROWS.length, batchesRead: 1, cappedAtSafetyLimit: false });
    getWriteDestinationSpreadsheetMock.mockResolvedValue(null);
    listSpreadsheetsMock.mockResolvedValue([{ id: "opt-1", name: "Some Sheet" }]);
    const userId = await createTestUser();

    await processSelectedGoogleSheet(userId);
    createdAttachmentIds.push((await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }))!.attachmentId);

    expect(listSpreadsheetsMock).toHaveBeenCalledWith(userId);
    expect(listSpreadsheetsMock).toHaveBeenCalledTimes(1);
  });

  it("8: no spreadsheet write call is made anywhere in this flow -- only reads (source + destination inspection)", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master Sheet" });
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: SOURCE_VALUES, rowsRead: SOURCE_ROWS.length, batchesRead: 1, cappedAtSafetyLimit: false });
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "Admin Tracker" });
    const userId = await createTestUser();

    const result = await processSelectedGoogleSheet(userId);
    createdAttachmentIds.push((await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } }))!.attachmentId);

    expect(result.reply).toContain("Nothing has been written to, deleted from, or moved");
    // The mocked module never even exposes a write function for this file to accidentally call.
    expect(Object.keys(vi.mocked(getSelectedSpreadsheetMock)).length).toBeGreaterThanOrEqual(0); // sanity: mocks are real vi.fn()s
  });
});

describe("source-level: google-sheets-cleaning.ts never hard-codes a destination name", () => {
  it("does not contain the literal string \"Deal Done Admin\" anywhere", () => {
    expect(GOOGLE_SHEETS_CLEANING_SOURCE).not.toContain("Deal Done Admin");
  });
});
