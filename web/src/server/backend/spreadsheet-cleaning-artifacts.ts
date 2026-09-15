// SPREADSHEET CLEANING ARTIFACTS (2026-09-02): real, private, ownership-scoped storage for the two
// generated review artifacts (a NEW cleaned XLSX workbook + a CSV cleaning audit) a pending
// SpreadsheetCleaningApproval produces. Mirrors attachments.ts's/deliverables.ts's own established
// private-storage convention EXACTLY: server-side storagePath under a root outside `public/`, the
// on-disk filename always derived from the approval's own id (never user input), retrieval only through
// an authenticated, ownership-checked route (see api/spreadsheet-cleaning/[id]/cleaned|audit/route.ts).
// Never touches, overwrites, or reads the ORIGINAL uploaded Attachment's bytes -- these are two brand
// new files, generated once, never mutated afterward.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { buildXlsxWorkbook } from "./xlsx-writer";
import { buildCleaningAuditCsv } from "./spreadsheet-cleaning";
import { mapToFinalBusinessSchema, splitByOrganicTraffic, ADMIN_VENDOR_SHEET_NAME, CLIENT_WEBSITES_SHEET_NAME, BUSINESS_SCHEMA_COLUMN_WIDTHS, BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS } from "./spreadsheet-business-schema";
import type { CleaningApprovalRecord } from "./spreadsheet-cleaning-approval";

const STORAGE_ROOT = path.join(process.cwd(), "var", "spreadsheet-cleaning");

export interface CleaningArtifactFile {
  readonly buffer: Buffer;
  readonly fileName: string;
  readonly mimeType: string;
}

/** Persists both real generated artifacts for one approval and records their real, id-derived storage paths on the row -- called once, immediately after the approval is created. */
export async function saveCleaningArtifacts(approvalId: string, cleanedWorkbook: Buffer, auditCsv: string): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
  const cleanedFileName = `${approvalId}-cleaned.xlsx`;
  const auditFileName = `${approvalId}-audit.csv`;
  await writeFile(path.join(STORAGE_ROOT, cleanedFileName), cleanedWorkbook);
  await writeFile(path.join(STORAGE_ROOT, auditFileName), auditCsv, "utf8");
  await db.spreadsheetCleaningApproval.update({
    where: { id: approvalId },
    data: { cleanedFileStoragePath: cleanedFileName, auditFileStoragePath: auditFileName },
  });
}

/**
 * SELF-HEALING BACKFILL (2026-09-02), ALWAYS-REGENERATE FIX (2026-09-03): a real, live-confirmed defect
 * -- this used to skip regeneration whenever BOTH storage paths were already non-null, which correctly
 * backfilled a genuinely missing artifact but then permanently froze it at whatever schema/business-logic
 * version was in effect on the turn it first ran. A real, live approval whose artifact was generated
 * before the 17-column business schema (or before the traffic split, or before the alias-matching /
 * embedded-header-row fixes) existed kept showing the OLD, wrong output forever afterward, since
 * "already has a path" always short-circuited before those newer fixes could ever run. This now ALWAYS
 * regenerates BOTH artifacts, purely from the approval's own already-persisted `result` (CleaningResult)
 * -- never re-reads or re-parses the original attachment, so it works even long after the original
 * upload -- guaranteeing every reload reflects the CURRENT, correct business-schema/traffic-split logic.
 * Regeneration is cheap (pure in-memory transform + one file write, no network) -- this trades a few
 * milliseconds of redundant work per reload for the correctness guarantee that a review/approval surface
 * genuinely needs.
 */
export async function ensureCleaningArtifactsGenerated(approval: CleaningApprovalRecord): Promise<void> {
  const businessSchema = mapToFinalBusinessSchema(approval.result.headers, approval.result.retainedRows, approval.result.urlColumnIndex);
  const trafficSplit = splitByOrganicTraffic(businessSchema);
  const workbook = buildXlsxWorkbook([
    { name: ADMIN_VENDOR_SHEET_NAME, headers: trafficSplit.adminVendor.headers, rows: trafficSplit.adminVendor.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
    { name: CLIENT_WEBSITES_SHEET_NAME, headers: trafficSplit.clientWebsites.headers, rows: trafficSplit.clientWebsites.rows, columnWidths: BUSINESS_SCHEMA_COLUMN_WIDTHS, wrapTextColumns: BUSINESS_SCHEMA_WRAP_TEXT_COLUMNS },
  ]);
  const auditCsv = buildCleaningAuditCsv(approval.result);
  await saveCleaningArtifacts(approval.id, workbook, auditCsv);
}

/** Real, ownership-scoped retrieval of one of the two generated artifacts. Returns null for "does not exist", "belongs to a different workspace", or "not generated yet" -- never a fabricated file. The display filename is derived from the ORIGINAL attachment's own name, purely for a friendly download name -- never used to build the real on-disk path. */
export async function retrieveCleaningArtifact(userId: string, approvalId: string, kind: "cleaned" | "audit"): Promise<CleaningArtifactFile | null> {
  const row = await db.spreadsheetCleaningApproval.findFirst({
    where: { id: approvalId, userId },
    include: { attachment: { select: { originalFileName: true } } },
  });
  if (!row) return null;

  const storagePath = kind === "cleaned" ? row.cleanedFileStoragePath : row.auditFileStoragePath;
  if (!storagePath) return null;

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(STORAGE_ROOT, storagePath));
  } catch {
    return null;
  }

  const baseName = row.attachment.originalFileName.replace(/\.[^./\\]+$/, "");
  return kind === "cleaned"
    ? { buffer, fileName: `${baseName} - Cleaned.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    : { buffer, fileName: `${baseName} - Cleaning Audit.csv`, mimeType: "text/csv" };
}
