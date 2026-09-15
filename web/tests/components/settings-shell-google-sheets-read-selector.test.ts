// EXPLICIT READ-SELECTION FIX (2026-09-13): source-level coverage of GoogleSheetsTool's "Read a
// spreadsheet" selector in settings-shell.tsx -- same no-render-harness convention as
// settings-shell-google-sheets-write-destination.test.ts's own header explains. Locks in the fix for the
// confirmed production defect: the selector used to unconditionally auto-select spreadsheets[0] (whichever
// spreadsheet Drive returned first, i.e. most recently modified) the instant the list loaded, with no
// "not yet selected" state and no restore of a previously-persisted selection on mount -- so ADASOS
// silently picked a spreadsheet ("Admin Sheet Health") instead of the user explicitly choosing one, and a
// page refresh reset the choice every time.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(path.resolve(__dirname, "../../src/components/settings/settings-shell.tsx"), "utf8");
const toolSource = shellSource.slice(shellSource.indexOf("function GoogleSheetsTool()"), shellSource.indexOf("interface UrlInspectionApiResult"));

describe("GoogleSheetsTool -- the read selector no longer silently auto-selects a spreadsheet", () => {
  it("never sets spreadsheetId to spreadsheets[0] as a side effect of loading the list -- the exact line that caused the reported defect", () => {
    expect(toolSource).not.toMatch(/setSpreadsheetId\(body\.spreadsheets\[0\]\.id\)/);
    expect(toolSource).not.toMatch(/if \(body\.spreadsheets\[0\]\) setSpreadsheetId/);
  });

  it("has an explicit 'Choose a spreadsheet…' placeholder option, matching the write-destination selector's own already-correct pattern", () => {
    const readSelectStart = toolSource.indexOf('aria-label="Spreadsheet"');
    const readSelectEnd = toolSource.indexOf("</select>", readSelectStart);
    const readSelectSource = toolSource.slice(readSelectStart, readSelectEnd);
    expect(readSelectSource).toContain("Choose a spreadsheet…");
  });

  it("G: fetches the persisted read selection from the server on mount, so a previously-selected spreadsheet survives a page refresh", () => {
    expect(toolSource).toMatch(/fetch\("\/api\/integrations\/google-sheets\/values"\)/);
    expect(toolSource).toContain("setPersistedSelection(body.selected)");
  });

  it("I: only trusts the persisted selection once it's confirmed present in a REAL, fresh spreadsheets list -- never blindly restores an id that might no longer be accessible", () => {
    expect(toolSource).toMatch(/const stillAvailable = spreadsheets\.some\(\(s\) => s\.id === persistedSelection\.id\)/);
    expect(toolSource).toContain("setSpreadsheetId(persistedSelection.id)");
    expect(toolSource).toContain("setSelectionUnavailable(true)");
  });

  it("I: shows a clear, explicit message instead of silently substituting a different spreadsheet when the persisted selection is unavailable", () => {
    expect(toolSource).toMatch(/selectionUnavailable \?/);
    expect(toolSource).toMatch(/no longer accessible/i);
  });

  it("never hardcodes 'Admin Sheet Health' or 'Health Master' anywhere -- the selector must work for any spreadsheet name, never a special case for these two", () => {
    expect(shellSource).not.toContain("Admin Sheet Health");
    expect(shellSource).not.toContain("Health Master");
  });

  it("still reuses the SAME already-fetched spreadsheets list for both selectors -- the discovery fix lives in listSpreadsheets() itself, never a second/duplicate query", () => {
    const driveListCalls = toolSource.match(/fetch\("\/api\/integrations\/google-sheets\/spreadsheets"\)/g) ?? [];
    expect(driveListCalls).toHaveLength(1);
  });

  it("F: the read selection and write destination remain two genuinely independent pieces of state -- unaffected by this fix", () => {
    expect(toolSource).toContain("const [spreadsheetId, setSpreadsheetId] = React.useState");
    expect(toolSource).toContain("const [writeDestinationId, setWriteDestinationId] = React.useState");
    expect(toolSource).toContain("const [persistedSelection, setPersistedSelection] = React.useState");
    expect(toolSource).toContain("const [currentDestination, setCurrentDestination] = React.useState");
  });
});
