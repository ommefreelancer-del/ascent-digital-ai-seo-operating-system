// READ-ONLY CLEANING PATH DEPENDENCY ISOLATION (2026-09-15): a real, live-confirmed problem --
// processSelectedGoogleSheet() (google-sheets-cleaning.ts) used to import SpreadsheetProcessingResult /
// buildSpreadsheetCleaningApprovalMeta from spreadsheet-processing.ts, which ALSO imports the Google
// Sheets WRITE-BACK path (writeApprovedCleaningToGoogleSheets, getWriteDestinationSpreadsheet from
// @/server/google-sheets) for its own, unrelated approve/reject handling. Because ES module imports
// resolve the whole target file, that made the READ-ONLY live-sheet cleaning path transitively depend on
// the write-back module and, through it, on @/server/google-sheets' currently-uncommitted
// credential-encryption migration -- even though processSelectedGoogleSheet() itself never writes
// anywhere and only ever calls getSelectedSpreadsheet()/getAllSpreadsheetValues() (see that file's own
// header). These are real source-level assertions (no test harness exists for import-graph shape in this
// codebase) proving: (1) google-sheets-cleaning.ts no longer imports spreadsheet-processing.ts at all, (2)
// it gets SpreadsheetProcessingResult/buildSpreadsheetCleaningApprovalMeta from the new, dependency-free
// spreadsheet-cleaning-approval-meta.ts instead, and (3) that new shared module itself never references
// the write-back path, @/server/google-sheets, or credential-encryption.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLEANING_SOURCE_PATH = path.resolve(__dirname, "../../../src/server/backend/google-sheets-cleaning.ts");
const META_SOURCE_PATH = path.resolve(__dirname, "../../../src/server/backend/spreadsheet-cleaning-approval-meta.ts");

const cleaningSource = readFileSync(CLEANING_SOURCE_PATH, "utf8");
const metaSource = readFileSync(META_SOURCE_PATH, "utf8");

describe("processSelectedGoogleSheet's read-only cleaning path no longer depends on the write-back/encryption chain", () => {
  it("google-sheets-cleaning.ts does not import spreadsheet-processing.ts (the write-back-entangled module) at all", () => {
    expect(cleaningSource).not.toMatch(/from ["']\.\/spreadsheet-processing["']/);
  });

  it("google-sheets-cleaning.ts imports SpreadsheetProcessingResult/buildSpreadsheetCleaningApprovalMeta from the new dependency-free shared module", () => {
    expect(cleaningSource).toMatch(
      /import \{ buildSpreadsheetCleaningApprovalMeta, type SpreadsheetProcessingResult \} from ["']\.\/spreadsheet-cleaning-approval-meta["']/,
    );
  });

  it("google-sheets-cleaning.ts's only Google Sheets import is the read-only surface (getSelectedSpreadsheet/getAllSpreadsheetValues) -- no write-scope or write-destination functions", () => {
    const importLine = cleaningSource.match(/import \{[^}]*\} from ["']@\/server\/google-sheets["'];/)?.[0] ?? "";
    expect(importLine).toContain("getSelectedSpreadsheet");
    expect(importLine).toContain("getAllSpreadsheetValues");
    expect(importLine).not.toMatch(/getWriteDestinationSpreadsheet|setWriteDestinationSpreadsheet|appendSpreadsheetValues|ensureSheetExists|assertSheetsWriteScope/);
  });

  it("the new shared approval-meta module's only import statement is the pre-existing, already-committed spreadsheet-cleaning-approval.ts type -- never the write-back path, @/server/google-sheets, or credential-encryption", () => {
    // Checks only real `import` STATEMENTS (never the module's own header comment, which legitimately
    // names these modules in prose to explain why this file was extracted -- see that comment's own text).
    const importLines = metaSource.match(/^import .*$/gm) ?? [];
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toMatch(/type \{ CleaningApprovalRecord \} from ["']\.\/spreadsheet-cleaning-approval["']/);
    expect(importLines[0]).not.toMatch(/spreadsheet-google-sheets-writeback|@\/server\/google-sheets|credential-encryption/);
  });
});
