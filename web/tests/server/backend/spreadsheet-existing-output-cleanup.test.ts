// EXISTING-OUTPUT-TAB SELF-CLEANUP (2026-09-21): real regression coverage for the new capability --
// reading back ADASOS's OWN already-written output tab (e.g. "Admin - Vendor"), proposing a read-only
// self-dedup, and (only once explicitly approved) clearing and rewriting exactly that tab. Real DB, real
// filesystem artifact writes (same established convention as the other cleaning-approval test suites) --
// only @/server/google-sheets is mocked, and only its real network-touching functions (the rest -- e.g.
// quoteSheetName -- stay real via importOriginal). Zero real network calls, zero live Google Drive/Sheets
// calls, zero paid API calls.

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";
import type { CleaningResult } from "../../../src/server/backend/spreadsheet-cleaning";

const getAllSpreadsheetValuesMock = vi.fn();
const getWriteDestinationSpreadsheetMock = vi.fn();
const clearAndReplaceSheetValuesMock = vi.fn();
const assertSheetsWriteScopeMock = vi.fn().mockResolvedValue(undefined);
const appendSpreadsheetValuesMock = vi.fn().mockResolvedValue(undefined);
const ensureSheetExistsMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/server/google-sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/google-sheets")>();
  return {
    ...actual,
    getAllSpreadsheetValues: (...args: unknown[]) => getAllSpreadsheetValuesMock(...args),
    getWriteDestinationSpreadsheet: (...args: unknown[]) => getWriteDestinationSpreadsheetMock(...args),
    clearAndReplaceSheetValues: (...args: unknown[]) => clearAndReplaceSheetValuesMock(...args),
    assertSheetsWriteScope: (...args: unknown[]) => assertSheetsWriteScopeMock(...args),
    appendSpreadsheetValues: (...args: unknown[]) => appendSpreadsheetValuesMock(...args),
    ensureSheetExists: (...args: unknown[]) => ensureSheetExistsMock(...args),
  };
});

const {
  proposeExistingOutputTabCleanup,
  proposeExistingOutputTabCleanupForChat,
  writeApprovedExistingOutputTabCleanupToGoogleSheets,
  writeApprovedCleaningRespectingMode,
  detectExistingOutputTabSelfCleanupRequest,
  collapseDomainDuplicatesToOnePerDomain,
  EXISTING_OUTPUT_CLEANUP_FILE_TYPE,
  KNOWN_LARGE_PLATFORM_DOMAINS,
} = await import("../../../src/server/backend/spreadsheet-existing-output-cleanup");
const { createPendingCleaningApproval, approveCleaningApproval } = await import("../../../src/server/backend/spreadsheet-cleaning-approval");
const { ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME } = await import("../../../src/server/backend/spreadsheet-business-schema");

const SPREADSHEET_CLEANING_STORAGE_ROOT = path.join(process.cwd(), "var", "spreadsheet-cleaning");

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

afterEach(async () => {
  getAllSpreadsheetValuesMock.mockReset();
  getWriteDestinationSpreadsheetMock.mockReset();
  clearAndReplaceSheetValuesMock.mockReset();
  assertSheetsWriteScopeMock.mockReset();
  assertSheetsWriteScopeMock.mockResolvedValue(undefined);
  appendSpreadsheetValuesMock.mockReset();
  appendSpreadsheetValuesMock.mockResolvedValue(undefined);
  ensureSheetExistsMock.mockReset();
  ensureSheetExistsMock.mockResolvedValue(undefined);
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
  const user = await db.user.create({ data: { name: "Existing Output Cleanup Test User", email: `existing-output-cleanup-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

describe("detectExistingOutputTabSelfCleanupRequest -- distinguishes a self-dedup request from every other Google Sheets message", () => {
  it("matches 'Admin - Vendor' + a dedup action phrase", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Please remove duplicates from Admin - Vendor.")).toEqual({
      adminVendor: true,
      clientSheet: false,
      dedupeByDomain: false,
      excludePlatformDomains: false,
    });
  });

  it("matches 'Client Sheet' + a dedup action phrase", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Can you clean up duplicates in the Client Sheet tab?")).toEqual({
      adminVendor: false,
      clientSheet: true,
      dedupeByDomain: false,
      excludePlatformDomains: false,
    });
  });

  it("matches both tabs when both are mentioned", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Are there still duplicates in Admin-Vendor and Client Sheet? Please remove them.")).toEqual({
      adminVendor: true,
      clientSheet: true,
      dedupeByDomain: false,
      excludePlatformDomains: false,
    });
  });

  it("sets dedupeByDomain true when the message explicitly asks for one record per website/domain", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("For Admin - Vendor, keep one unique record per website/domain and remove duplicate rows.")).toEqual({
      adminVendor: true,
      clientSheet: false,
      dedupeByDomain: true,
      excludePlatformDomains: false,
    });
  });

  it("sets excludePlatformDomains AND dedupeByDomain true when the message asks to exclude platform domains, even without separate 'per domain' phrasing", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Clean up duplicates in Admin - Vendor, excluding large platform domains.")).toEqual({
      adminVendor: true,
      clientSheet: false,
      dedupeByDomain: true,
      excludePlatformDomains: true,
    });
  });

  it("matches a differently-worded platform-exclusion request too ('exclude platforms')", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Remove duplicates from Client Sheet, one record per domain, exclude platforms like LinkedIn and Facebook.")).toEqual({
      adminVendor: false,
      clientSheet: true,
      dedupeByDomain: true,
      excludePlatformDomains: true,
    });
  });

  it("returns null when neither output tab is mentioned", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Please remove duplicates from Health Master Sheet.")).toBeNull();
  });

  it("returns null when a tab is mentioned but there is no dedup/cleanup action language", () => {
    expect(detectExistingOutputTabSelfCleanupRequest("Please email the Client Sheet to the team.")).toBeNull();
  });
});

describe("proposeExistingOutputTabCleanupForChat -- platform-exclusion wiring end to end (chat entry point)", () => {
  it("a real chat message asking to exclude platform domains actually leaves KNOWN_LARGE_PLATFORM_DOMAINS rows untouched, via the full detect -> chat-dispatch -> propose pipeline", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://linkedin.com/post-1", "40"], // known platform domain -- should be excluded from collapse
        ["https://linkedin.com/post-2", "41"], // same domain, differing content -- should ALSO be kept
        ["https://alpha.com/a", "40"], // non-platform domain -- kept (lowest of its group)
        ["https://alpha.com/b", "41"], // non-platform domain -- removed by the collapse
      ],
      rowsRead: 4,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const message = "Clean up duplicates in Admin - Vendor, one record per domain, excluding large platform domains.";
    const targets = detectExistingOutputTabSelfCleanupRequest(message);
    expect(targets).toEqual({ adminVendor: true, clientSheet: false, dedupeByDomain: true, excludePlatformDomains: true });

    const result = await proposeExistingOutputTabCleanupForChat(userId, targets!);

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("EXCLUDED from domain-level collapsing");
    expect(result.reply).toContain('Domain "linkedin.com"');
    expect(result.approvalMeta?.retainedRowCount).toBe(3);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://linkedin.com/post-1", "40"],
      ["https://linkedin.com/post-2", "41"],
      ["https://alpha.com/a", "40"],
    ]);
  });

  it("PERMANENT RULE: even WITHOUT platform-exclusion phrasing, a plain 'one record per domain' chat request still protects known platform domains -- collapseDomainDuplicatesToOnePerDomain() enforces this unconditionally now, not the chat phrase detector", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://linkedin.com/post-1", "40"],
        ["https://linkedin.com/post-2", "41"],
      ],
      rowsRead: 2,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const message = "Clean up duplicates in Client Sheet, one record per domain.";
    const targets = detectExistingOutputTabSelfCleanupRequest(message);
    expect(targets).toEqual({ adminVendor: false, clientSheet: true, dedupeByDomain: true, excludePlatformDomains: false });

    const result = await proposeExistingOutputTabCleanupForChat(userId, targets!);

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("EXCLUDED from domain-level collapsing");
    expect(result.approvalMeta?.retainedRowCount).toBe(2); // both linkedin.com rows retained -- never collapsed

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
  });

  it("KNOWN_LARGE_PLATFORM_DOMAINS is a real, non-empty, exported list (the same one used by this wiring)", () => {
    expect(KNOWN_LARGE_PLATFORM_DOMAINS.length).toBeGreaterThan(10);
    expect(KNOWN_LARGE_PLATFORM_DOMAINS).toContain("linkedin.com");
    expect(KNOWN_LARGE_PLATFORM_DOMAINS).toContain("facebook.com");
  });
});

describe("proposeExistingOutputTabCleanup -- real, read-only self-dedup proposal", () => {
  it("reports honestly when no write destination is configured yet, and never calls getAllSpreadsheetValues", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue(null);
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("write destination");
    expect(getAllSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("reports honestly when the tab read fails", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockRejectedValue(new Error("network boom"));
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("network boom");
  });

  it("reports honestly when the tab is genuinely empty", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({ values: [], rowsRead: 0, batchesRead: 1, cappedAtSafetyLimit: false });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("genuinely empty");
  });

  it("reads the named tab (via the sheetName option), self-dedupes real exact-duplicate rows, and persists a real pending approval with the correct fileType marker", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://alpha.com", "40"],
        ["https://alpha.com", "40"], // exact duplicate of the row above
        ["https://beta.com", "55"],
      ],
      rowsRead: 3,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME);

    expect(getAllSpreadsheetValuesMock).toHaveBeenCalledWith(userId, "dest-1", expect.objectContaining({ sheetName: ADMIN_VENDOR_SHEET_NAME }));
    expect(result.ok).toBe(true);
    expect(result.reply).toContain("Admin - Vendor");
    expect(result.reply).toContain("Retained records: 2");
    expect(result.reply).toContain("CLEARS the entire");
    expect(result.approvalMeta?.retainedRowCount).toBe(2);
    expect(result.approvalMeta?.originalRowCount).toBe(3);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    expect(approval).not.toBeNull();
    createdAttachmentIds.push(approval!.attachmentId);
    const attachment = await db.attachment.findUnique({ where: { id: approval!.attachmentId } });
    expect(attachment?.fileType).toBe(EXISTING_OUTPUT_CLEANUP_FILE_TYPE);
    expect(attachment?.originalFileName).toBe(ADMIN_VENDOR_SHEET_NAME);
  });

  it("with { dedupeDomainDuplicates: true }, collapses same-domain rows down to exactly one retained record per domain, on top of exact-duplicate removal", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://alpha.com/a", "40"], // domain alpha.com -- kept (lowest row)
        ["https://alpha.com/a", "40"], // exact duplicate of the row above -- removed by exact-dedup
        ["https://alpha.com/b", "41"], // same domain (alpha.com), different path/value -- removed by domain-dedup
        ["https://beta.com", "55"], // unique domain -- kept
      ],
      rowsRead: 4,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("FULL DOMAIN DEDUP");
    expect(result.reply).toContain("Retained records: 2");
    expect(result.reply.toLowerCase()).toContain("one record per website/domain");
    expect(result.approvalMeta?.retainedRowCount).toBe(2);
    expect(result.approvalMeta?.originalRowCount).toBe(4);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    expect(approval!.resultJson).toBeTruthy();
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://alpha.com/a", "40"],
      ["https://beta.com", "55"],
    ]);
  });

  it("PERMANENT RULE: known large platform domains (e.g. linkedin.com) are excluded from collapsing by DEFAULT -- no options needed at all", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://linkedin.com/post-1", "40"], // known platform domain -- kept
        ["https://linkedin.com/post-2", "41"], // known platform domain -- ALSO kept (never collapsed)
        ["https://alpha.com/a", "40"], // non-platform domain -- kept
        ["https://alpha.com/b", "41"], // non-platform domain -- removed
      ],
      rowsRead: 4,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    // Deliberately NO additionalExcludedDomains option -- proves platform protection is unconditional.
    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("EXCLUDED from domain-level collapsing");
    expect(result.reply).toContain('Domain "linkedin.com"');
    expect(result.approvalMeta?.retainedRowCount).toBe(3);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://linkedin.com/post-1", "40"],
      ["https://linkedin.com/post-2", "41"],
      ["https://alpha.com/a", "40"],
    ]);
  });

  it("with { dedupeDomainDuplicates: true, additionalExcludedDomains: [...] }, leaves an EXTRA (non-platform) excluded domain's rows untouched too, while still collapsing every other domain", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://example-vendor.com/page-1", "40"], // additionally excluded, non-platform domain -- kept
        ["https://example-vendor.com/page-2", "41"], // ALSO kept (not collapsed)
        ["https://alpha.com/a", "40"], // ordinary domain -- kept
        ["https://alpha.com/b", "41"], // ordinary domain -- removed
      ],
      rowsRead: 4,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true, additionalExcludedDomains: ["example-vendor.com"] });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("EXCLUDED from domain-level collapsing");
    expect(result.reply).toContain('Domain "example-vendor.com"');
    expect(result.approvalMeta?.retainedRowCount).toBe(3);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://example-vendor.com/page-1", "40"],
      ["https://example-vendor.com/page-2", "41"],
      ["https://alpha.com/a", "40"],
    ]);
  });

  it("PERMANENT RULE: a domain-duplicate group with exactly ONE already-priced member keeps THAT member, regardless of row order, and removes the unpriced sibling", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA", "Client Price", "Profit"],
        ["https://alpha.com/unpriced", "40", "", ""], // lower row index, but NOT priced -- must be removed
        ["https://alpha.com/priced", "41", "500", "120"], // higher row index, but IS priced -- must be kept
      ],
      rowsRead: 2,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true });

    expect(result.ok).toBe(true);
    expect(result.approvalMeta?.retainedRowCount).toBe(1);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([["https://alpha.com/priced", "41", "500", "120"]]);
  });

  it("PERMANENT RULE: a domain-duplicate group with TWO already-priced members is left completely alone -- both kept, flagged for manual review, never auto-resolved", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA", "Client Price", "Profit"],
        ["https://alpha.com/priced-1", "40", "500", "120"], // priced
        ["https://alpha.com/priced-2", "41", "600", "150"], // ALSO priced -- ambiguous, must not guess
      ],
      rowsRead: 2,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true });

    expect(result.ok).toBe(true);
    expect(result.reply).toContain("KEPT BOTH FOR REVIEW");
    expect(result.approvalMeta?.retainedRowCount).toBe(2);
    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://alpha.com/priced-1", "40", "500", "120"],
      ["https://alpha.com/priced-2", "41", "600", "150"],
    ]);
  });

  it("RECONCILIATION FIX: when a row is BOTH an exact-duplicate extra AND a domain-group member, the reply's totals reconcile exactly (rows read = exact removed + domain-additional removed + retained), never double-counting the overlapping row", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://alpha.com/a", "40"], // index 0 -- kept (canonical for both the exact-dup group and the domain group)
        ["https://alpha.com/a", "40"], // index 1 -- EXACT duplicate of row 0 -- removed by exact-dedup; ALSO a member of the alpha.com domain group
        ["https://alpha.com/b", "41"], // index 2 -- same domain, differing value -- removed by domain-collapse (genuinely additional, no exact-dup overlap)
        ["https://beta.com", "99"], // index 3 -- unrelated, kept
      ],
      rowsRead: 4,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME, { dedupeDomainDuplicates: true });

    expect(result.ok).toBe(true);
    expect(result.approvalMeta?.retainedRowCount).toBe(2);
    expect(result.approvalMeta?.originalRowCount).toBe(4);
    // The headline must report the ACTUAL removed count per category (1 exact + 1 domain-additional = 2 total), never the raw, double-counting sum (2 + 2 = 4).
    expect(result.reply).toContain("2 row(s) proposed for removal: 1 exact-duplicate row(s), plus 1 additional row(s)");
    expect(result.reply).toContain("Total removed:                                        2  (= 1 + 1)");
    expect(result.reply).toContain("MATCHES rows read.");
    expect(result.reply).not.toContain("DOES NOT MATCH");

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
    const persistedResult = JSON.parse(approval!.resultJson) as CleaningResult;
    expect(persistedResult.retainedRows).toEqual([
      ["https://alpha.com/a", "40"],
      ["https://beta.com", "99"],
    ]);
  });

  it("without the option (default), a domain-duplicate row with differing values is still only flagged, never removed -- unchanged prior behavior", async () => {
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "dest-1", name: "SaaS Website Master Database" });
    getAllSpreadsheetValuesMock.mockResolvedValue({
      values: [
        ["Clean URL", "DA"],
        ["https://alpha.com/a", "40"],
        ["https://alpha.com/b", "41"], // same domain, differing value -- flagged, not removed, by default
      ],
      rowsRead: 2,
      batchesRead: 1,
      cappedAtSafetyLimit: false,
    });
    const userId = await createTestUser();

    const result = await proposeExistingOutputTabCleanup(userId, ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(true);
    expect(result.approvalMeta?.retainedRowCount).toBe(2);
    expect(result.approvalMeta?.domainDuplicateRowCount).toBe(2);

    const approval = await db.spreadsheetCleaningApproval.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    createdAttachmentIds.push(approval!.attachmentId);
  });
});

describe("collapseDomainDuplicatesToOnePerDomain -- pure, deterministic 'one record per domain' reducer", () => {
  it("keeps the lowest-indexed row per domain group and removes every other member, leaving unrelated retained rows untouched", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://alpha.com/a", "40"], // index 0 -- kept (lowest of the alpha.com group)
      ["https://gamma.com", "10"], // index 1 -- unrelated, unique domain
      ["https://alpha.com/b", "41"], // index 2 -- same domain as index 0, differing value -- removed
      ["https://alpha.com/c", "42"], // index 3 -- same domain again -- removed
    ];
    const base = buildCleaningResult(headers, rows);
    expect(base.domainDuplicateGroups).toHaveLength(1);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);

    expect(collapsed.domainDuplicateKeptRowIndexes.has(0)).toBe(true);
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(2)).toBe(true);
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(3)).toBe(true);
    expect(collapsed.result.retainedRowIndexes).toEqual([0, 1]);
    expect(collapsed.result.retainedRows).toEqual([
      ["https://alpha.com/a", "40"],
      ["https://gamma.com", "10"],
    ]);
  });

  it("domainDuplicateAdditionalRemovedRowIndexes excludes a row already removed by exact-duplicate collapse -- the reconciling set, distinct from the raw domainDuplicateRemovedRowIndexes", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://alpha.com/a", "40"], // index 0 -- kept
      ["https://alpha.com/a", "40"], // index 1 -- EXACT duplicate of row 0 -- already removed by exact-dedup; ALSO a domain-group member
      ["https://alpha.com/b", "41"], // index 2 -- same domain, differing value -- genuinely additional removal
    ];
    const base = buildCleaningResult(headers, rows);
    expect(base.exactDuplicateGroups).toHaveLength(1);
    expect(base.domainDuplicateGroups).toHaveLength(1);
    expect(base.retainedRowIndexes).toEqual([0, 2]); // exact-dedup alone already dropped row 1

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);

    // Raw set includes both non-canonical members (1 and 2) of the domain group.
    expect(collapsed.domainDuplicateRemovedRowIndexes).toEqual(new Set([1, 2]));
    // Reconciling set excludes row 1 -- it was already gone from base.retainedRowIndexes before this pass ran.
    expect(collapsed.domainDuplicateAdditionalRemovedRowIndexes).toEqual(new Set([2]));
    expect(collapsed.result.retainedRowIndexes).toEqual([0]);

    // The actual reconciliation invariant this field exists to satisfy:
    const exactRemoved = base.exactDuplicateGroups.reduce((sum, g) => sum + g.rowIndexes.length, 0) - base.exactDuplicateGroups.length;
    expect(exactRemoved + collapsed.domainDuplicateAdditionalRemovedRowIndexes.size + collapsed.result.retainedRowIndexes.length).toBe(base.originalRowCount);
  });

  it("is a safe no-op when there are no domain-duplicate groups at all", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://alpha.com", "40"],
      ["https://beta.com", "55"],
    ];
    const base = buildCleaningResult(headers, rows);
    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);
    expect(collapsed.result.retainedRowIndexes).toEqual(base.retainedRowIndexes);
    expect(collapsed.domainDuplicateRemovedRowIndexes.size).toBe(0);
  });

  it("PERMANENT RULE: a known large platform domain's group is completely untouched (every member retained, none removed) with NO options at all, while still collapsing a non-platform domain", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://linkedin.com/post-1", "40"], // index 0 -- known platform domain, differing content -- kept
      ["https://linkedin.com/post-2", "41"], // index 1 -- known platform domain -- kept too (not collapsed)
      ["https://alpha.com/a", "40"], // index 2 -- ordinary domain -- kept (lowest of its group)
      ["https://alpha.com/b", "41"], // index 3 -- ordinary domain -- removed
    ];
    const base = buildCleaningResult(headers, rows);
    expect(base.domainDuplicateGroups).toHaveLength(2);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base); // deliberately no options

    expect(collapsed.excludedDomainGroups).toHaveLength(1);
    expect(collapsed.excludedDomainGroups[0]!.normalizedDomain).toBe("linkedin.com");
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(0)).toBe(false);
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(1)).toBe(false);
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(3)).toBe(true);
    expect(collapsed.result.retainedRowIndexes).toEqual([0, 1, 2]);
    // Both linkedin.com rows stay flagged for manual review (genuinely still ambiguous -- never resolved automatically).
    expect(collapsed.result.manualReviewRowIndexes).toEqual([0, 1]);
  });

  it("additionalExcludedDomains adds a NON-platform domain to the always-on platform exclusion, without disabling it", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA"];
    const rows = [
      ["https://example-vendor.com/a", "40"], // additionally excluded -- kept
      ["https://example-vendor.com/b", "41"], // additionally excluded -- kept too
      ["https://alpha.com/a", "40"],
      ["https://alpha.com/b", "41"], // ordinary domain -- removed
    ];
    const base = buildCleaningResult(headers, rows);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base, { additionalExcludedDomains: new Set(["example-vendor.com"]) });

    expect(collapsed.excludedDomainGroups.map((g) => g.normalizedDomain).sort()).toEqual(["example-vendor.com"]);
    expect(collapsed.result.retainedRowIndexes).toEqual([0, 1, 2]);
  });

  it("PERMANENT RULE: a group with exactly one already-priced member is collapsed to THAT member, even when it is not the lowest row index", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA", "Client Price"];
    const rows = [
      ["https://alpha.com/unpriced", "40", ""], // index 0 -- lower index, but unpriced -- removed
      ["https://alpha.com/priced", "41", "500"], // index 1 -- higher index, but priced -- kept
    ];
    const base = buildCleaningResult(headers, rows);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);

    expect(collapsed.domainDuplicateKeptRowIndexes.has(1)).toBe(true);
    expect(collapsed.domainDuplicateRemovedRowIndexes.has(0)).toBe(true);
    expect(collapsed.result.retainedRowIndexes).toEqual([1]);
    expect(collapsed.pricingProtectedGroups).toHaveLength(0);
  });

  it("PERMANENT RULE: a group with two or more already-priced members is left entirely alone -- pricingProtectedGroups records it, nothing removed", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA", "Client Price"];
    const rows = [
      ["https://alpha.com/priced-1", "40", "500"],
      ["https://alpha.com/priced-2", "41", "600"],
    ];
    const base = buildCleaningResult(headers, rows);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);

    expect(collapsed.pricingProtectedGroups).toHaveLength(1);
    expect(collapsed.pricingProtectedGroups[0]!.normalizedDomain).toBe("alpha.com");
    expect(collapsed.domainDuplicateRemovedRowIndexes.size).toBe(0);
    expect(collapsed.result.retainedRowIndexes).toEqual([0, 1]);
    expect(collapsed.result.manualReviewRowIndexes).toEqual([0, 1]);
  });

  it("recognizes the real 'Admin Prices' (plural) header as a pricing column, not just the singular 'Admin Price'", async () => {
    const { buildCleaningResult } = await import("../../../src/server/backend/spreadsheet-cleaning");
    const headers = ["Clean URL", "DA", "Admin Prices "]; // real, live-confirmed header spelling (plural + trailing space)
    const rows = [
      ["https://alpha.com/unpriced", "40", ""],
      ["https://alpha.com/priced", "41", "300"],
    ];
    const base = buildCleaningResult(headers, rows);

    const collapsed = collapseDomainDuplicatesToOnePerDomain(base);

    expect(collapsed.result.retainedRowIndexes).toEqual([1]); // the "Admin Prices"-priced row is kept, not the lowest index
  });
});

describe("writeApprovedExistingOutputTabCleanupToGoogleSheets -- the first real clear-and-replace write path", () => {
  async function createApprovedRecord(userId: string, result: CleaningResult) {
    const attachment = await db.attachment.create({
      data: { userId, originalFileName: ADMIN_VENDOR_SHEET_NAME, fileType: EXISTING_OUTPUT_CLEANUP_FILE_TYPE, mimeType: "application/vnd.google-apps.spreadsheet", sizeBytes: 0, storagePath: "" },
    });
    createdAttachmentIds.push(attachment.id);
    const pending = await createPendingCleaningApproval(userId, attachment.id, result);
    const approved = await approveCleaningApproval(userId, pending.id);
    return approved.record!;
  }

  const RESULT: CleaningResult = {
    headers: ["Clean URL", "DA"],
    originalRowCount: 2,
    urlColumnIndex: 0,
    exactDuplicateGroups: [],
    domainDuplicateGroups: [],
    malformedUrlRows: [],
    incompleteRows: [],
    retainedRowIndexes: [0, 1],
    retainedRows: [
      ["https://alpha.com", "40"],
      ["https://beta.com", "55"],
    ],
    manualReviewRowIndexes: [],
  };

  it("refuses to write a still-pending approval", async () => {
    const userId = await createTestUser();
    const attachment = await db.attachment.create({
      data: { userId, originalFileName: ADMIN_VENDOR_SHEET_NAME, fileType: EXISTING_OUTPUT_CLEANUP_FILE_TYPE, mimeType: "application/vnd.google-apps.spreadsheet", sizeBytes: 0, storagePath: "" },
    });
    createdAttachmentIds.push(attachment.id);
    const pending = await createPendingCleaningApproval(userId, attachment.id, RESULT);

    const result = await writeApprovedExistingOutputTabCleanupToGoogleSheets(userId, pending, "dest-1", ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(false);
    expect(clearAndReplaceSheetValuesMock).not.toHaveBeenCalled();
  });

  it("on success, clears and replaces the named tab with exactly the approved header + retained rows, and marks the approval written", async () => {
    clearAndReplaceSheetValuesMock.mockResolvedValue(undefined);
    const userId = await createTestUser();
    const approved = await createApprovedRecord(userId, RESULT);

    const result = await writeApprovedExistingOutputTabCleanupToGoogleSheets(userId, approved, "dest-1", ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(true);
    expect(result.rowsWritten).toBe(2);
    expect(clearAndReplaceSheetValuesMock).toHaveBeenCalledWith(userId, "dest-1", ADMIN_VENDOR_SHEET_NAME, RESULT.headers, RESULT.retainedRows);

    const reloaded = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approved.id } });
    expect(reloaded?.status).toBe("written");
  });

  it("on failure, persists write_failed (never left ambiguously 'approved') and returns the real error", async () => {
    clearAndReplaceSheetValuesMock.mockRejectedValue(new Error("Sheets API boom"));
    const userId = await createTestUser();
    const approved = await createApprovedRecord(userId, RESULT);

    const result = await writeApprovedExistingOutputTabCleanupToGoogleSheets(userId, approved, "dest-1", ADMIN_VENDOR_SHEET_NAME);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Sheets API boom");
    const reloaded = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approved.id } });
    expect(reloaded?.status).toBe("write_failed");
  });
});

describe("writeApprovedCleaningRespectingMode -- the single dispatch point between the two real write behaviors", () => {
  const RESULT: CleaningResult = {
    headers: ["Domain", "Contact"],
    originalRowCount: 1,
    urlColumnIndex: 0,
    exactDuplicateGroups: [],
    domainDuplicateGroups: [],
    malformedUrlRows: [],
    incompleteRows: [],
    retainedRowIndexes: [0],
    retainedRows: [["example.com", "Alice"]],
    manualReviewRowIndexes: [],
  };

  it("dispatches an EXISTING_OUTPUT_CLEANUP_FILE_TYPE-marked approval to the clear-and-replace path", async () => {
    clearAndReplaceSheetValuesMock.mockResolvedValue(undefined);
    const userId = await createTestUser();
    const attachment = await db.attachment.create({
      data: { userId, originalFileName: CLIENT_WEBSITES_SHEET_NAME, fileType: EXISTING_OUTPUT_CLEANUP_FILE_TYPE, mimeType: "application/vnd.google-apps.spreadsheet", sizeBytes: 0, storagePath: "" },
    });
    createdAttachmentIds.push(attachment.id);
    const pending = await createPendingCleaningApproval(userId, attachment.id, RESULT);
    const approved = await approveCleaningApproval(userId, pending.id);

    const dispatch = await writeApprovedCleaningRespectingMode(userId, approved.record!, "dest-1");

    expect(dispatch.mode).toBe("existing-tab-replace");
    if (dispatch.mode === "existing-tab-replace") {
      expect(dispatch.result.tabName).toBe(CLIENT_WEBSITES_SHEET_NAME);
    }
    expect(clearAndReplaceSheetValuesMock).toHaveBeenCalledWith(userId, "dest-1", CLIENT_WEBSITES_SHEET_NAME, RESULT.headers, RESULT.retainedRows);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("dispatches an ordinary (non-marker) approval to the existing append-split path, completely unaffected by this new module", async () => {
    const userId = await createTestUser();
    const attachment = await db.attachment.create({
      data: { userId, originalFileName: "prospects.xlsx", fileType: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 100, storagePath: "irrelevant.xlsx" },
    });
    createdAttachmentIds.push(attachment.id);
    const pending = await createPendingCleaningApproval(userId, attachment.id, RESULT);
    const approved = await approveCleaningApproval(userId, pending.id);

    const dispatch = await writeApprovedCleaningRespectingMode(userId, approved.record!, "dest-1");

    expect(dispatch.mode).toBe("append-split");
    expect(clearAndReplaceSheetValuesMock).not.toHaveBeenCalled();
    expect(appendSpreadsheetValuesMock).toHaveBeenCalled();
  });
});
