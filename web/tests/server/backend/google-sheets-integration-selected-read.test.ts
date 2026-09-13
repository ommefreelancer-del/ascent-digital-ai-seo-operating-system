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

/** Routes a stubbed fetch to a Drive files.list response or a Sheets values.get response, matching whichever real endpoint each real call actually hits -- never a single blanket mock that can't tell them apart. */
function routedFetchMock(driveFiles: Array<{ id: string; name: string }>, sheetsValues: string[][] | null, sheetsOk = true) {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("googleapis.com/drive/v3/files")) {
      return { ok: true, text: async () => JSON.stringify({ files: driveFiles }) };
    }
    if (url.includes("sheets.googleapis.com")) {
      if (!sheetsOk) {
        return { ok: false, status: 403, statusText: "Forbidden", text: async () => '{"error":{"message":"The caller does not have permission"}}' };
      }
      return { ok: true, text: async () => JSON.stringify({ range: "Sheet1!A1:Z1000", majorDimension: "ROWS", values: sheetsValues ?? [] }) };
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
    expect(sheetsUrl).toContain("/values/A1%3AZ1000");
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

  it("TRUNCATION: more than 200 real rows are truncated for the prompt, honestly labeled, never silently dropped without saying so", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const manyRows = Array.from({ length: 250 }, (_, i) => [`row-${i}`]);
    const fetchMock = routedFetchMock([{ id: "health-master-id", name: "Health Master Sheet" }], manyRows);
    vi.stubGlobal("fetch", fetchMock);

    const { buildGoogleSheetsContext } = await import("../../../src/server/backend/google-sheets-integration");
    const context = await buildGoogleSheetsContext("user-1");

    expect(context).toContain("returned 250 row(s)");
    expect(context).toContain("...and 50 more row(s) not shown here");
    expect(context).toContain("row-0");
    expect(context).toContain("row-199");
    expect(context).not.toContain("row-200");
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
