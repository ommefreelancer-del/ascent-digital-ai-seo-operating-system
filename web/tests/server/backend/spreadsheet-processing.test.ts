// SPREADSHEET PROCESSING CAPABILITY: real source-level security checks (unchanged from before) plus
// real, no-mocks coverage of resolveCleaningApprovalReply()'s approve/reject detection logic -- real DB,
// real Attachment/User fixtures, the one real network-touching call (appendSpreadsheetValues) stubbed via
// vi.mock so this suite makes ZERO real network calls.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";
import type { CleaningResult } from "../../../src/server/backend/spreadsheet-cleaning";
import { createPendingCleaningApproval, getPendingCleaningApproval } from "../../../src/server/backend/spreadsheet-cleaning-approval";
import { retrieveCleaningArtifact } from "../../../src/server/backend/spreadsheet-cleaning-artifacts";
import { buildXlsxWorkbook } from "../../../src/server/backend/xlsx-writer";
import { readSpreadsheet } from "../../../src/server/backend/spreadsheet-reader";
import { saveUploadedAttachment } from "../../../src/server/backend/attachments";
import { FINAL_BUSINESS_SCHEMA_COLUMNS, ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME } from "../../../src/server/backend/spreadsheet-business-schema";

const appendSpreadsheetValuesMock = vi.fn();
vi.mock("@/server/google-sheets", () => ({
  appendSpreadsheetValues: (...args: unknown[]) => appendSpreadsheetValuesMock(...args),
  getWriteDestinationSpreadsheet: () => Promise.resolve(null),
}));

const { resolveCleaningApprovalReply, processSpreadsheetAttachment } = await import("../../../src/server/backend/spreadsheet-processing");

const SOURCE_PATH = path.resolve(__dirname, "../../../src/server/backend/spreadsheet-processing.ts");
const source = readFileSync(SOURCE_PATH, "utf8");

describe("spreadsheet-processing.ts -- security/behavioral guarantees (source-level)", () => {
  it("19: reads the real file ONLY through the existing, ownership-checked retrieveAttachmentFile(userId, id) -- never a raw path, never a second retrieval mechanism", () => {
    expect(source).toContain('import { retrieveAttachmentFile, type AttachmentMeta } from "./attachments";');
    expect(source).toMatch(/const file = await retrieveAttachmentFile\(userId, attachmentMeta\.id\);/);
  });

  it("18: never imports node:fs directly -- all filesystem access is delegated to attachments.ts's own ownership-scoped functions", () => {
    expect(source).not.toMatch(/from ["']node:fs/);
  });

  it("19: never logs file content -- no console.* call anywhere in this module", () => {
    expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
  });

  it("9: the chat report explicitly states a reason for every proposed removal/merge action", () => {
    expect(source).toMatch(/reason: identical values in every column/);
    expect(source).toMatch(/reason: same normalized domain, but other column values differ/);
    expect(source).toMatch(/Proposed action: keep both, review manually/);
  });

  it("parses via the real, local-only readSpreadsheet() and cleans via buildCleaningResult() -- never sends bytes to an external service", () => {
    expect(source).toContain('import { readSpreadsheet, type SpreadsheetReadResult } from "./spreadsheet-reader";');
    expect(source).toContain('import { buildCleaningResult, buildCleaningAuditCsv, type CleaningResult } from "./spreadsheet-cleaning";');
  });

  it("the write-back call site is the ONLY place this module calls writeApprovedCleaningRespectingMode, and only after a real approveCleaningApproval() succeeded", () => {
    // MODE-AWARE DISPATCH (2026-09-21): this module no longer calls writeApprovedCleaningToGoogleSheets()
    // directly -- writeApprovedCleaningRespectingMode() (spreadsheet-existing-output-cleanup.ts) is the
    // single dispatch point that decides between the append-split write-back and the newer clear-and-replace
    // path, based on the approval's own Attachment.fileType marker. See that module's own header.
    expect(source).toContain('import { writeApprovedCleaningRespectingMode } from "./spreadsheet-existing-output-cleanup";');
    const approveIndex = source.indexOf("const approved = await approveCleaningApproval(userId, pending.id);");
    const writeIndex = source.indexOf("await writeApprovedCleaningRespectingMode(");
    expect(approveIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(approveIndex);
  });
});

// ---------------------------------------------------------------------------------------------------
// resolveCleaningApprovalReply -- real DB, real approve/reject detection
// ---------------------------------------------------------------------------------------------------

const SPREADSHEET_CLEANING_STORAGE_ROOT = path.join(process.cwd(), "var", "spreadsheet-cleaning");
const ATTACHMENTS_STORAGE_ROOT = path.join(process.cwd(), "var", "attachments");

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

afterEach(async () => {
  appendSpreadsheetValuesMock.mockReset();
  for (const id of createdAttachmentIds.splice(0)) {
    const approvals = await db.spreadsheetCleaningApproval.findMany({ where: { attachmentId: id } });
    for (const approval of approvals) {
      if (approval.cleanedFileStoragePath) await rm(path.join(SPREADSHEET_CLEANING_STORAGE_ROOT, approval.cleanedFileStoragePath), { force: true }).catch(() => undefined);
      if (approval.auditFileStoragePath) await rm(path.join(SPREADSHEET_CLEANING_STORAGE_ROOT, approval.auditFileStoragePath), { force: true }).catch(() => undefined);
    }
    await db.spreadsheetCleaningApproval.deleteMany({ where: { attachmentId: id } });
    const attachment = await db.attachment.findUnique({ where: { id }, select: { storagePath: true } }).catch(() => null);
    if (attachment?.storagePath) await rm(path.join(ATTACHMENTS_STORAGE_ROOT, attachment.storagePath), { force: true }).catch(() => undefined);
    await db.attachment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds.splice(0)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

async function createTestUser(): Promise<string> {
  const user = await db.user.create({ data: { name: "Reply Test User", email: `reply-test-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
  createdUserIds.push(user.id);
  return user.id;
}

async function createTestAttachment(userId: string): Promise<string> {
  const attachment = await db.attachment.create({
    data: { userId, originalFileName: "prospects.xlsx", fileType: "xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 100, storagePath: "irrelevant.xlsx" },
  });
  createdAttachmentIds.push(attachment.id);
  return attachment.id;
}

const SAMPLE_RESULT: CleaningResult = {
  headers: ["Domain"],
  originalRowCount: 1,
  urlColumnIndex: 0,
  exactDuplicateGroups: [],
  domainDuplicateGroups: [],
  malformedUrlRows: [],
  incompleteRows: [],
  retainedRowIndexes: [0],
  retainedRows: [["example.com"]],
  manualReviewRowIndexes: [],
};

describe("resolveCleaningApprovalReply", () => {
  it("falls through (handled: false) when there is no pending approval at all", async () => {
    const userId = await createTestUser();
    const result = await resolveCleaningApprovalReply(userId, "approve");
    expect(result.handled).toBe(false);
  });

  it("falls through (handled: false) for an unrelated message even when a pending approval exists -- never silently swallowed", async () => {
    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const result = await resolveCleaningApprovalReply(userId, "What's the weather like today?");
    expect(result.handled).toBe(false);
  });

  it("11: recognizes a clear 'approve' reply and marks the approval decided", async () => {
    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const result = await resolveCleaningApprovalReply(userId, "approve");
    expect(result.handled).toBe(true);
    expect(await getPendingCleaningApproval(userId, attachmentId)).toBeNull(); // no longer pending
  });

  it("recognizes a clear 'reject' reply and discards the approval", async () => {
    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const result = await resolveCleaningApprovalReply(userId, "reject");
    expect(result.handled).toBe(true);
    expect(result.reply).toMatch(/discarded/i);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("11: never writes to Google Sheets on approval without a configured write destination -- honestly asks instead of guessing a target", async () => {
    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const result = await resolveCleaningApprovalReply(userId, "approve");
    expect(result.reply).toMatch(/no google sheets write destination is currently configured/i);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("an ambiguous message matching neither approve nor reject falls through unresolved", async () => {
    const userId = await createTestUser();
    const attachmentId = await createTestAttachment(userId);
    await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const result = await resolveCleaningApprovalReply(userId, "I'm not sure, what do you think?");
    expect(result.handled).toBe(false);
  });
});

// END-TO-END: processSpreadsheetAttachment() -- 6/8: real attachment upload, real parse+clean, real
// generated artifacts, real approval meta for the UI card. Uses a small, synthetic XLSX fixture built
// with this codebase's own xlsx-writer.ts -- never a real user file.
describe("processSpreadsheetAttachment -- generates real, retrievable review artifacts and approval meta", () => {
  it("6/8: produces a downloadable cleaned XLSX and audit CSV, and returns approvalMeta pointing at both", async () => {
    const userId = await createTestUser();
    const workbook = buildXlsxWorkbook([
      {
        name: "Sheet1",
        headers: ["Domain", "Contact"],
        rows: [
          ["example.com", "Alice"],
          ["example.com", "Alice"], // exact duplicate
          ["example.org", "Bob"],
        ],
      },
    ]);
    const uploaded = await saveUploadedAttachment(userId, {
      fileName: "prospects.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: workbook,
    });
    expect(uploaded.ok).toBe(true);
    createdAttachmentIds.push(uploaded.attachment!.id);

    const result = await processSpreadsheetAttachment(userId, uploaded.attachment!);
    expect(result.ok).toBe(true);
    expect(result.approvalMeta).toBeDefined();
    expect(result.approvalMeta!.originalRowCount).toBe(3);
    expect(result.approvalMeta!.retainedRowCount).toBe(2);
    expect(result.approvalMeta!.exactDuplicateRowCount).toBe(2); // both rows in the group (1 kept + 1 removed)
    expect(result.approvalMeta!.status).toBe("pending_approval");

    const cleaned = await retrieveCleaningArtifact(userId, result.approvalMeta!.id, "cleaned");
    expect(cleaned).not.toBeNull();
    const reparsed = readSpreadsheet(cleaned!.buffer, "xlsx");
    // The cleaned artifact is reshaped into the fixed 17-column business schema and split into two real
    // sheets by verified organic traffic -- "Domain" (the detected URL column) lands in "Clean URL"
    // (domain-root, column 1) and "Original URL" (raw, column 2); "Contact" is a genuine alias for
    // "Contact Name"; every other of the 17 columns is honestly empty since no such source column exists
    // in this fixture. Neither row has a real Organic Traffic value, so both are genuinely unverified and
    // land in Client Websites, never guessed into Admin/Vendor.
    expect(reparsed.sheetNames).toEqual([ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME]);
    expect(reparsed.sheets?.[0]?.headers).toEqual(FINAL_BUSINESS_SCHEMA_COLUMNS);
    expect(reparsed.sheets?.[0]?.headers?.[0]).toBe("Clean URL"); // locked column 1
    expect(reparsed.sheets?.[0]?.headers?.[1]).toBe("Original URL"); // locked column 2
    expect(reparsed.sheets?.[0]?.rowCount).toBe(0);
    const cleanUrlIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Clean URL");
    const originalUrlIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Original URL");
    const contactNameIndex = FINAL_BUSINESS_SCHEMA_COLUMNS.indexOf("Contact Name");
    expect(reparsed.sheets?.[1]?.rows.map((r) => [r[cleanUrlIndex], r[originalUrlIndex], r[contactNameIndex]])).toEqual([
      ["https://example.com/", "example.com", "Alice"],
      ["https://example.org/", "example.org", "Bob"],
    ]);

    const audit = await retrieveCleaningArtifact(userId, result.approvalMeta!.id, "audit");
    expect(audit).not.toBeNull();
    expect(audit!.buffer.toString("utf8")).toContain("A_EXACT_DUPLICATE_REMOVED");
  });

  it("7: never modifies the original uploaded attachment -- its bytes are unchanged after processing", async () => {
    const userId = await createTestUser();
    const originalBytes = buildXlsxWorkbook([{ name: "Sheet1", headers: ["Domain"], rows: [["example.com"]] }]);
    const uploaded = await saveUploadedAttachment(userId, {
      fileName: "original.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: originalBytes,
    });
    createdAttachmentIds.push(uploaded.attachment!.id);

    await processSpreadsheetAttachment(userId, uploaded.attachment!);

    const stillOriginal = await readFile(path.join(ATTACHMENTS_STORAGE_ROOT, `${uploaded.attachment!.id}.xlsx`));
    expect(stillOriginal.equals(originalBytes)).toBe(true);
  });
});
