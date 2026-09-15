// SPREADSHEET CLEANING APPROVAL SERVER ACTIONS: real DB coverage for approveCleaningApprovalAction()/
// rejectCleaningApprovalAction(), with the two real network-touching pieces (auth session +
// appendSpreadsheetValues) mocked -- this suite makes ZERO real network calls and ZERO real
// authentication. The gating/dispatch logic itself (approve -> attempt write only if a WRITE DESTINATION
// is configured; reject -> never touches the write path) is real and unmocked. READ/WRITE SEPARATION
// (2026-09-03): the approval action now sources its target spreadsheet from getWriteDestinationSpreadsheet()
// -- a genuinely separate, explicitly-configured field -- never getSelectedSpreadsheet() (the "Read a
// spreadsheet" tool's own selection, which must never silently double as a write destination).

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../src/server/db";
import type { CleaningResult } from "../../../src/server/backend/spreadsheet-cleaning";
import { createPendingCleaningApproval, approveCleaningApproval } from "../../../src/server/backend/spreadsheet-cleaning-approval";
import { mapToFinalBusinessSchema, CLIENT_WEBSITES_SHEET_NAME } from "../../../src/server/backend/spreadsheet-business-schema";

const appendSpreadsheetValuesMock = vi.fn();
const getWriteDestinationSpreadsheetMock = vi.fn();
const ensureSheetExistsMock = vi.fn().mockResolvedValue(undefined);
const assertSheetsWriteScopeMock = vi.fn().mockResolvedValue(undefined);
// Real quoteSheetName() (and every other real export) is preserved via importOriginal -- only the real
// network-touching functions are mocked. ensureSheetExists()/assertSheetsWriteScope() (tab-existence and
// scope-gate fixes) are real no-ops here by default -- their own behavior is covered by dedicated test
// files (google-sheets-tab-existence.test.ts, google-sheets.test.ts).
vi.mock("@/server/google-sheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/google-sheets")>();
  return {
    ...actual,
    appendSpreadsheetValues: (...args: unknown[]) => appendSpreadsheetValuesMock(...args),
    getWriteDestinationSpreadsheet: (...args: unknown[]) => getWriteDestinationSpreadsheetMock(...args),
    ensureSheetExists: (...args: unknown[]) => ensureSheetExistsMock(...args),
    assertSheetsWriteScope: (...args: unknown[]) => assertSheetsWriteScopeMock(...args),
  };
});

let mockUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  getServerAuthSession: () => Promise.resolve(mockUserId ? { user: { id: mockUserId, email: "test@example.com" } } : null),
}));

const { approveCleaningApprovalAction, rejectCleaningApprovalAction, retryWriteToGoogleSheetsAction } = await import("../../../src/server/backend/spreadsheet-cleaning-actions");

const createdUserIds: string[] = [];
const createdAttachmentIds: string[] = [];

afterEach(async () => {
  appendSpreadsheetValuesMock.mockReset();
  getWriteDestinationSpreadsheetMock.mockReset();
  ensureSheetExistsMock.mockReset();
  ensureSheetExistsMock.mockResolvedValue(undefined);
  assertSheetsWriteScopeMock.mockReset();
  assertSheetsWriteScopeMock.mockResolvedValue(undefined);
  mockUserId = null;
  for (const id of createdAttachmentIds.splice(0)) {
    await db.spreadsheetCleaningApproval.deleteMany({ where: { attachmentId: id } }).catch(() => undefined);
    await db.attachment.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of createdUserIds.splice(0)) {
    await db.user.delete({ where: { id } }).catch(() => undefined);
  }
});

async function createTestUser(): Promise<string> {
  const user = await db.user.create({ data: { name: "Actions Test User", email: `cleaning-actions-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" } });
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

describe("approveCleaningApprovalAction", () => {
  it("11: requires a real authenticated session -- refuses when unauthenticated", async () => {
    mockUserId = null;
    const state = await approveCleaningApprovalAction("does-not-matter", null, new FormData());
    expect(state.ok).toBe(false);
    expect(state.error).toBe("Unauthorized");
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("10/11: approves the correct approval record and does not write when no write destination is configured", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue(null);

    const state = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(state.ok).toBe(true);
    expect(state.status).toBe("approved");
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
    expect(state.message).toMatch(/write destination/i);

    const row = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("approved");
  });

  it("12: when a write destination is configured, approval writes ONLY the approved record's retained dataset", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-abc", name: "My Sheet" });
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);

    const state = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(state.ok).toBe(true);
    expect(state.status).toBe("written");
    expect(appendSpreadsheetValuesMock).toHaveBeenCalledTimes(1);
    // 12/14: the write payload is reshaped into the fixed 17-column business schema, never the raw source
    // headers/rows -- SAMPLE_RESULT has no real Traffic column, so its one row is genuinely unverified
    // and lands in Client Websites, never guessed into Admin/Vendor.
    const expectedSchema = mapToFinalBusinessSchema(SAMPLE_RESULT.headers, SAMPLE_RESULT.retainedRows, SAMPLE_RESULT.urlColumnIndex);
    const expectedValues = [expectedSchema.headers, ...expectedSchema.rows];
    // A1-NOTATION RANGE FIX (2026-09-03): the sheet name is quoted (required -- it contains spaces), and
    // the range's column/row extent reflects the ACTUAL 17-column, real payload dimensions -- never a
    // bare, unquoted "Client Websites!A1" (which is what a real Google 400 rejected in production).
    expect(appendSpreadsheetValuesMock).toHaveBeenCalledWith(userId, "sheet-abc", `'${CLIENT_WEBSITES_SHEET_NAME}'!A1:Q${expectedValues.length}`, expectedValues);
    expect(state.message).toContain("Admin/Vendor");
    expect(state.message).toContain("Client Sheet");
  });

  it("11: never approves or writes for another user's approval id", async () => {
    const ownerId = await createTestUser();
    const strangerId = await createTestUser();
    mockUserId = strangerId;
    const attachmentId = await createTestAttachment(ownerId);
    const approval = await createPendingCleaningApproval(ownerId, attachmentId, SAMPLE_RESULT);

    const state = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(state.ok).toBe(false);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  // WRITE-RESULT STATE FIX (2026-09-03): a real, live-confirmed defect -- a failed write used to return
  // the SAME "approved" status as a genuine success, so the UI showed a plain "Approved" badge with no
  // indication the destination spreadsheet was still empty and no way to retry. 1/8: approval and a
  // successful write are now genuinely distinct outcomes.
  it("1/8: a failed write returns the genuinely distinct 'write_failed' status, never 'approved' -- and persists it so a retry path exists", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-abc", name: "My Sheet" });
    appendSpreadsheetValuesMock.mockRejectedValue(new Error("Sheets API refused: insufficient scope"));

    const state = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(state.ok).toBe(true);
    expect(state.status).toBe("write_failed");
    expect(state.message).toMatch(/insufficient scope/i);

    const row = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("write_failed");
  });
});

describe("retryWriteToGoogleSheetsAction -- 2/6/7/8/9/10/11: real retry of a previously-failed write", () => {
  it("requires a real authenticated session", async () => {
    mockUserId = null;
    const state = await retryWriteToGoogleSheetsAction("does-not-matter", null, new FormData());
    expect(state.ok).toBe(false);
    expect(state.error).toBe("Unauthorized");
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("refuses for a nonexistent approval id", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const state = await retryWriteToGoogleSheetsAction("does-not-exist", null, new FormData());
    expect(state.ok).toBe(false);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("11: refuses for another user's approval id -- never retries or exposes a stranger's write", async () => {
    const ownerId = await createTestUser();
    const strangerId = await createTestUser();
    const attachmentId = await createTestAttachment(ownerId);
    const approval = await createPendingCleaningApproval(ownerId, attachmentId, SAMPLE_RESULT);
    await approveCleaningApproval(ownerId, approval.id);
    mockUserId = strangerId;

    const state = await retryWriteToGoogleSheetsAction(approval.id, null, new FormData());
    expect(state.ok).toBe(false);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("refuses for a still-pending approval -- nothing to retry until it's actually been approved", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const state = await retryWriteToGoogleSheetsAction(approval.id, null, new FormData());
    expect(state.ok).toBe(false);
    expect(state.error).toMatch(/nothing to retry/i);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("2/6: retries a real write for a 'write_failed' approval and, on success, returns 'written'", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-abc", name: "My Sheet" });
    appendSpreadsheetValuesMock.mockRejectedValueOnce(new Error("temporary failure"));
    const failedFirst = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(failedFirst.status).toBe("write_failed");

    appendSpreadsheetValuesMock.mockResolvedValue(undefined);
    const retryState = await retryWriteToGoogleSheetsAction(approval.id, null, new FormData());

    expect(retryState.ok).toBe(true);
    expect(retryState.status).toBe("written");
    expect(appendSpreadsheetValuesMock).toHaveBeenCalledTimes(2); // 1 failed attempt + 1 successful retry

    const row = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("written");
  });

  it("7/8: a retry that fails again still returns/persists 'write_failed', never a falsely final state", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-abc", name: "My Sheet" });
    appendSpreadsheetValuesMock.mockRejectedValue(new Error("still broken"));
    await approveCleaningApprovalAction(approval.id, null, new FormData());

    const retryState = await retryWriteToGoogleSheetsAction(approval.id, null, new FormData());
    expect(retryState.ok).toBe(true);
    expect(retryState.status).toBe("write_failed");

    const row = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("write_failed");
  });

  it("10: never retries (and never calls appendSpreadsheetValues) for an already-'written' approval -- a confirmed success can never be duplicated", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);
    getWriteDestinationSpreadsheetMock.mockResolvedValue({ id: "sheet-abc", name: "My Sheet" });
    appendSpreadsheetValuesMock.mockResolvedValue(undefined);
    const written = await approveCleaningApprovalAction(approval.id, null, new FormData());
    expect(written.status).toBe("written");
    appendSpreadsheetValuesMock.mockClear();

    const retryState = await retryWriteToGoogleSheetsAction(approval.id, null, new FormData());
    expect(retryState.ok).toBe(false);
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
  });
});

describe("rejectCleaningApprovalAction", () => {
  it("13: rejects the correct approval and never touches the write path", async () => {
    const userId = await createTestUser();
    mockUserId = userId;
    const attachmentId = await createTestAttachment(userId);
    const approval = await createPendingCleaningApproval(userId, attachmentId, SAMPLE_RESULT);

    const state = await rejectCleaningApprovalAction(approval.id, null, new FormData());
    expect(state.ok).toBe(true);
    expect(state.status).toBe("rejected");
    expect(appendSpreadsheetValuesMock).not.toHaveBeenCalled();
    expect(getWriteDestinationSpreadsheetMock).not.toHaveBeenCalled();

    const row = await db.spreadsheetCleaningApproval.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("rejected");
  });
});
