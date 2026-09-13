// AGENT READ-WIRING FIX (2026-09-13): real, live-confirmed production defect -- once a user had
// selected a spreadsheet ("Health Master Sheet") as their Google Sheets read source, the Google Sheets
// Integration Agent could still only see the spreadsheet's NAME/id in its context, never its actual row
// data, and buildGoogleSheetsContext() explicitly instructed it that "to read actual values, the user
// must specify a spreadsheet and a range" -- so the agent correctly (per that instruction) asked the user
// to paste/attach Sheet1's data, even though ADASOS already has a live, authenticated connection and a
// persisted selection for exactly that spreadsheet. This file proves the fix: buildGoogleSheetsContext()
// now calls the REAL, already-existing getSpreadsheetValues() itself, using a bare range (no sheet-name
// prefix -- the Sheets API's own documented way to read a spreadsheet's first sheet, e.g. "Sheet1",
// without needing to already know its exact tab name), and embeds the REAL returned rows directly in the
// context -- never inventing a new data path, never asking the user to paste anything.
//
// BATCH READ FIX (2026-09-14): a real, live-confirmed follow-on defect -- a single bounded read
// ("A1:Z1000") silently missed rows past its own upper bound, and this file's context builder separately
// capped its own DISPLAYED rows at 200 regardless of how many were actually read -- so a genuinely
// 1000+-row sheet ("Health Master Sheet"'s Sheet1) was never seen completely by the agent. Proves
// getAllSpreadsheetValues()'s real, successive, row-bounded batching (500 rows/call) reads a 1000+ row
// sheet completely, that ALL of it (not a smaller display-only subset) reaches the agent's context, and
// that a genuine safety-ceiling case is still reported honestly rather than silently presented as
// "complete."
//
// Same mocking convention as tests/server/google-sheets.test.ts (this session's own established,
// HEAD-compatible pattern): `db` is mocked with a plaintext-token connection fixture, `fetch` is stubbed
// for Google's own HTTP endpoints -- zero real network calls, zero live Google Drive/Sheets calls, zero
// paid API calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    googleServiceConnection: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

const CONNECTED_AT = new Date("2026-09-01T00:00:00Z");
const VALID_CONNECTION = {
  userId: "user-1",
  service: "sheets",
  accessToken: "valid-access-token",
  refreshToken: "refresh-token",
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  updatedAt: CONNECTED_AT,
  metadataJson: JSON.stringify({ selectedSpreadsheetId: "health-master-id", selectedSpreadsheetName: "Health Master Sheet" }),
};

const CONNECTION_NO_SELECTION = { ...VALID_CONNECTION, metadataJson: null };

/**
 * Routes a stubbed fetch to a Drive files.list response or a Sheets values.get response, matching
 * whichever real endpoint each real call actually hits -- never a single blanket mock that can't tell
 * them apart. For Sheets, a REAL row-bounded slice of `allSheetsRows` is returned for whatever row range
 * the real batching logic actually requested (parsed from the real request URL) -- exactly how the real
 * Sheets API behaves (a batch naturally returns fewer rows than requested once it runs past the sheet's
 * real data), so getAllSpreadsheetValues()'s real stopping logic is genuinely exercised, never faked.
 */
function routedFetchMock(driveFiles: Array<{ id: string; name: string }>, allSheetsRows: string[][] | null, sheetsOk = true) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("googleapis.com/drive/v3/files")) {
      return { ok: true, text: async () => JSON.stringify({ files: driveFiles }) };
    }
    if (url.includes("sheets.googleapis.com")) {
      if (!sheetsOk) {
        return { ok: false, status: 403, statusText: "Forbidden", text: async () => '{"error":{"message":"The caller does not have permission"}}' };
      }
      const match = url.match(/values\/A(\d+)%3AZ(\d+)/);
      const startRow = match ? parseInt(match[1]!, 10) : 1;
      const endRow = match ? parseInt(match[2]!, 10) : Number.MAX_SAFE_INTEGER;
      const rows = allSheetsRows ?? [];
      const slice = rows.slice(startRow - 1, endRow);
      return { ok: true, text: async () => JSON.stringify({ range: `Sheet1!A${startRow}:Z${endRow}`, majorDimension: "ROWS", values: slice }) };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

describe("buildGoogleSheetsContext -- reads the persisted selected spreadsheet's real rows instead of asking the user to paste data", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("REPRODUCES + FIXES THE LIVE DEFECT: a selected spreadsheet with real rows is embedded directly -- the agent is never told to ask the user for Sheet1 data", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock(
      [{ id: "health-master-id", name: "Health Master Sheet" }],
      [
        ["URL", "Status", "Last Checked"],
        ["https://example.com/a", "OK", "2026-09-10"],
        ["https://example.com/b", "BROKEN", "2026-09-10"],
      ],
    );
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).toContain('Currently selected spreadsheet for this integration: "Health Master Sheet"');
    expect(context).toContain("returned 3 row(s)");
    expect(context).toContain("https://example.com/a");
    expect(context).toContain("BROKEN");
    expect(context).toContain("Use the real data above directly -- never ask the user to paste or attach it");
    // The old, defect-causing instruction must be gone for a selected spreadsheet -- the agent must
    // never be told (and must never tell the user) to paste/attach data that ADASOS can already read
    // itself. Checks for the actual REQUEST phrasing, not just the words "paste"/"attach" appearing
    // anywhere (this context's own new instruction legitimately says "never ask... to paste or attach").
    expect(context).not.toContain("the user must specify a spreadsheet and a range");
    expect(context).not.toMatch(/please (paste|attach)/i);
    expect(context).not.toMatch(/(paste|attach) (the|your|sheet1'?s?) data/i);
  });

  it("reads with a BARE range (no sheet-name prefix) so the Sheets API reads the first sheet (Sheet1) automatically -- never requires knowing the exact tab name up front", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], [["a", "b"]]);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    await buildGoogleSheetsContext("user-1");

    const sheetsCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes("sheets.googleapis.com"));
    expect(sheetsCall).toBeDefined();
    const sheetsUrl = sheetsCall![0] as string;
    expect(sheetsUrl).toContain("/values/A1%3AZ500");
    expect(sheetsUrl).not.toMatch(/values\/Sheet1/);
  });

  it("USES THE PERSISTED SELECTION, not a hardcoded id: getSpreadsheetValues is called with exactly the persisted selectedSpreadsheetId", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], [["x"]]);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    await buildGoogleSheetsContext("user-1");

    const sheetsCall = fetchMock.mock.calls.find((c) => (c[0] as string).includes("sheets.googleapis.com"));
    expect(sheetsCall![0]).toContain("/spreadsheets/health-master-id/values/");
  });

  it("NO SELECTION: never calls getSpreadsheetValues at all, and still tells the user to select a spreadsheet first (unchanged prior behavior)", async () => {
    findUniqueMock.mockResolvedValue(CONNECTION_NO_SELECTION);
    const fetchMock = routedFetchMock([{ id: "sheet-1", name: "Some Sheet" }], null);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("sheets.googleapis.com"))).toBe(false);
    expect(context).toContain("No spreadsheet is currently selected");
    expect(context).toContain("the user must first select a spreadsheet in Settings -> Integrations");
  });

  it("HONEST EMPTY RESULT: a selected spreadsheet that genuinely has zero rows in range is reported as empty, never fabricated placeholder rows", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], []);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).toContain("found zero rows");
    expect(context).toContain("genuinely empty");
  });

  it("ANTI-FABRICATION ON READ FAILURE: a real failed values.get call is reported honestly, never silently treated as a successful read", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], null, false);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).toContain("failed");
    expect(context).toContain("do not guess at row contents or claim the read succeeded");
  });

  it("REPRODUCES + FIXES THE 1000+ ROW DEFECT: a genuinely 1000+ row Sheet1 (e.g. Health Master Sheet) is read COMPLETELY across multiple real batches, with every row reaching the agent -- never truncated at 200", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    // 1200 real rows, including a HEADER row repeated verbatim later in the data (row 601) -- proves
    // batching/accumulation never deduplicates or otherwise mishandles repeated content across a batch
    // boundary (500-row batches put this repeat inside the SECOND batch).
    const header = ["URL", "Status", "Last Checked"];
    const rows = [header];
    for (let i = 1; i < 1200; i++) {
      rows.push(i === 600 ? header : [`https://example.com/${i}`, "OK", "2026-09-10"]);
    }
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], rows);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    // 3 real batches: rows 1-500, 501-1000, 1001-1200 (the third, short batch is the real signal that
    // the true end of data was reached -- confirmed below via "complete sheet", never the safety ceiling).
    const sheetsCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes("sheets.googleapis.com"));
    expect(sheetsCalls).toHaveLength(3);
    expect(context).toContain("3 real spreadsheets.values.get call(s)");
    expect(context).toContain("returned 1200 row(s) total");
    expect(context).toContain("Row 1: URL | Status | Last Checked");
    expect(context).toContain("Row 601: URL | Status | Last Checked"); // the repeated header row, verbatim, not deduplicated
    expect(context).toContain("Row 1200: https://example.com/1199 | OK | 2026-09-10"); // the real LAST row -- proves nothing was cut off
    expect(context).toContain("This is the complete sheet -- reading stopped because a real batch returned fewer rows than requested");
    expect(context).not.toContain("not shown here");
    expect(context).not.toContain("safety limit");
  });

  it("SAFETY CEILING: a genuinely pathological sheet that never returns a short batch is honestly reported as capped, never silently presented as the complete sheet", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    // Every batch returns a FULL 500 rows forever (simulates a sheet far larger than any real ADASOS use
    // case, or a misbehaving response) -- the real MAX_TOTAL_ROWS ceiling (5000) must still stop this
    // deterministically, and the result must say so honestly rather than imply completeness.
    const endlessRows = Array.from({ length: 100_000 }, (_, i) => [`row-${i}`]);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], endlessRows);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    const sheetsCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes("sheets.googleapis.com"));
    expect(sheetsCalls.length).toBeLessThanOrEqual(10); // bounded, never unbounded real API calls
    expect(context).toContain("returned 5000 row(s) total");
    expect(context).toMatch(/real safety limit \(5000 rows\)/);
    expect(context).toContain("this sheet may genuinely have more rows beyond what's shown");
    expect(context).not.toContain("This is the complete sheet");
  });

  it("PRESERVES THE HUMAN-APPROVAL RULE: the context explicitly states this is read-only and any write still needs the existing approval flow", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], [["a"]]);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).toMatch(/read only/i);
    expect(context).toContain("existing explicit human-approval flow");
  });

  it("NO CREDENTIAL/TOKEN LEAKAGE: the real access/refresh token strings never appear in the returned context", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], [["a", "b"]]);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).not.toContain("valid-access-token");
    expect(context).not.toContain("refresh-token");
  });
});
