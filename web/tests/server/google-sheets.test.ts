import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret } from "../../src/server/credential-encryption";

if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
}

const { findUniqueMock, updateMock, upsertMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    googleServiceConnection: {
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: upsertMock,
    },
  },
}));

const VALID_CONNECTION = {
  userId: "user-1",
  service: "sheets",
  encryptedAccessToken: encryptSecret("valid-access-token"),
  encryptedRefreshToken: encryptSecret("refresh-token"),
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

const WRITE_SCOPED_CONNECTION = {
  ...VALID_CONNECTION,
  scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly",
};

describe("listSpreadsheets", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the real Drive files.list endpoint filtered to spreadsheets, with the connection's access token", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ files: [{ id: "sheet-1", name: "Client Tracker", modifiedTime: "2026-01-01T00:00:00Z" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    const result = await listSpreadsheets("user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://www.googleapis.com/drive/v3/files?");
    expect(url).toContain("mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27");
    expect(init.headers.Authorization).toBe("Bearer valid-access-token");
    expect(result).toEqual([{ id: "sheet-1", name: "Client Tracker", modifiedTime: "2026-01-01T00:00:00Z" }]);
  });

  it("throws with the full response body when Google returns a non-2xx status", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => '{"error":{"message":"The caller does not have permission"}}',
      }),
    );

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    await expect(listSpreadsheets("user-1")).rejects.toThrow(/Drive files\.list failed: 403 Forbidden.*does not have permission/);
  });

  it("throws when there is no Google Sheets connection for the user", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    await expect(listSpreadsheets("user-1")).rejects.toThrow("No Google Sheets connection exists for this user.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // SPREADSHEET-DISCOVERY FIX (2026-09-13): real regression coverage for the confirmed production
  // defect -- a real user's newly-created "Health Master" spreadsheet never appeared anywhere in the
  // Settings selectors. Two real, provable code-level gaps: (J) only the first Drive results page was
  // ever fetched (no pageToken follow-up), and (corpus) the query never asked Drive to include Shared
  // Drive-resident files. Neither fix touches OAuth scope -- same drive.metadata.readonly token throughout.

  it("J: follows Drive's nextPageToken until exhausted -- a spreadsheet on page 2+ (e.g. beyond the first 25/100 by modifiedTime) is never silently dropped", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ nextPageToken: "page-2-token", files: [{ id: "sheet-1", name: "Admin Sheet Health", modifiedTime: "2026-09-10T00:00:00Z" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ files: [{ id: "sheet-2", name: "Health Master", modifiedTime: "2026-09-01T00:00:00Z" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    const result = await listSpreadsheets("user-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1]![0] as string;
    expect(secondUrl).toContain("pageToken=page-2-token");
    expect(result).toEqual([
      { id: "sheet-1", name: "Admin Sheet Health", modifiedTime: "2026-09-10T00:00:00Z" },
      { id: "sheet-2", name: "Health Master", modifiedTime: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("A/C: returns every spreadsheet from a single page, including a newly-created one, when there is no nextPageToken", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          files: [
            { id: "sheet-1", name: "Admin Sheet Health", modifiedTime: "2026-09-10T00:00:00Z" },
            { id: "sheet-2", name: "Health Master", modifiedTime: "2026-09-12T00:00:00Z" },
            { id: "sheet-3", name: "Client Tracker", modifiedTime: "2026-08-01T00:00:00Z" },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    const result = await listSpreadsheets("user-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.map((f) => f.name)).toEqual(["Admin Sheet Health", "Health Master", "Client Tracker"]);
  });

  it("corpus: requests corpora=allDrives, includeItemsFromAllDrives=true, and supportsAllDrives=true -- so a spreadsheet living in a Shared Drive is not silently excluded by Drive's default 'My Drive'-only corpus", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ files: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    await listSpreadsheets("user-1");

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("corpora=allDrives");
    expect(url).toContain("includeItemsFromAllDrives=true");
    expect(url).toContain("supportsAllDrives=true");
  });

  it("K: two spreadsheets with the identical name are both returned, distinguishable only by their real, stable Drive file id -- never deduplicated or merged by name", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          files: [
            { id: "sheet-a", name: "Report", modifiedTime: "2026-09-10T00:00:00Z" },
            { id: "sheet-b", name: "Report", modifiedTime: "2026-09-05T00:00:00Z" },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { listSpreadsheets } = await import("../../src/server/google-sheets");
    const result = await listSpreadsheets("user-1");

    expect(result).toHaveLength(2);
    expect(result.map((f) => f.id)).toEqual(["sheet-a", "sheet-b"]);
    expect(new Set(result.map((f) => f.id)).size).toBe(2);
  });
});

// RECONNECT-PRESERVES-SELECTION (2026-09-13, H): a real requirement -- reconnecting Google Sheets OAuth
// (a fresh consent -> new access/refresh token pair) must never arbitrarily replace a user's already-
// explicitly-selected read/write spreadsheet. saveConnection() is the ONE function a reconnect calls
// (see callback/route.ts) -- this locks in that its upsert never touches metadataJson at all, so the
// persisted selection survives a reconnect untouched, without needing to inspect its value.
describe("saveConnection -- reconnecting OAuth never touches the persisted spreadsheet selection", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
    upsertMock.mockReset();
  });

  it("H: the upsert's update/create payloads include only token/scope/expiry fields -- never metadataJson", async () => {
    upsertMock.mockResolvedValue({});

    const { saveConnection } = await import("../../src/server/google-sheets");
    await saveConnection("user-1", { access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly", token_type: "Bearer" });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0]![0];
    expect(call.update).not.toHaveProperty("metadataJson");
    expect(call.create).not.toHaveProperty("metadataJson");
    expect(Object.keys(call.update).sort()).toEqual(["encryptedAccessToken", "encryptedRefreshToken", "expiresAt", "scope"]);
  });
});

describe("getSpreadsheetValues", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the real Sheets spreadsheets.values.get endpoint for the given range", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ range: "Sheet1!A1:B2", majorDimension: "ROWS", values: [["Name", "Status"], ["Acme", "Active"]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getSpreadsheetValues("user-1", "sheet-1", "Sheet1!A1:B2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1%3AB2");
    expect(init.headers.Authorization).toBe("Bearer valid-access-token");
    expect(result.values).toEqual([["Name", "Status"], ["Acme", "Active"]]);
  });

  it("throws with the full response body when Google returns a non-2xx status", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => '{"error":{"message":"Unable to parse range"}}',
      }),
    );

    const { getSpreadsheetValues } = await import("../../src/server/google-sheets");
    await expect(getSpreadsheetValues("user-1", "sheet-1", "bad range")).rejects.toThrow(
      /Sheets spreadsheets\.values\.get failed: 400 Bad Request.*Unable to parse range/,
    );
  });
});

// READ/WRITE SEPARATION (2026-09-03): a real, live-confirmed defect -- getSelectedSpreadsheet()/
// setSelectedSpreadsheet() are the "Read a spreadsheet" tool's OWN field, silently reused by the
// spreadsheet-cleaning write-back as if it were a write destination. getWriteDestinationSpreadsheet()/
// setWriteDestinationSpreadsheet() are a genuinely SEPARATE field on the SAME metadataJson blob -- setting
// one must never clobber the other, since a read-mode helper (mergeMetadata) always read-modify-writes.
describe("getWriteDestinationSpreadsheet / setWriteDestinationSpreadsheet -- genuinely separate from the read-selection field", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  it("returns null when no write destination has ever been configured", async () => {
    findUniqueMock.mockResolvedValue({ metadataJson: null });
    const { getWriteDestinationSpreadsheet } = await import("../../src/server/google-sheets");
    expect(await getWriteDestinationSpreadsheet("user-1")).toBeNull();
  });

  it("returns null when only a READ selection exists -- never falls back to it as a write destination", async () => {
    findUniqueMock.mockResolvedValue({ metadataJson: JSON.stringify({ selectedSpreadsheetId: "read-sheet", selectedSpreadsheetName: "Read Sheet" }) });
    const { getWriteDestinationSpreadsheet } = await import("../../src/server/google-sheets");
    expect(await getWriteDestinationSpreadsheet("user-1")).toBeNull();
  });

  it("setWriteDestinationSpreadsheet persists a write destination WITHOUT touching an existing read selection", async () => {
    findUniqueMock.mockResolvedValue({ metadataJson: JSON.stringify({ selectedSpreadsheetId: "read-sheet", selectedSpreadsheetName: "Read Sheet" }) });
    const { setWriteDestinationSpreadsheet } = await import("../../src/server/google-sheets");
    await setWriteDestinationSpreadsheet("user-1", "write-sheet", "Write Sheet");

    expect(updateMock).toHaveBeenCalledTimes(1);
    const savedMetadata = JSON.parse(updateMock.mock.calls[0]![0].data.metadataJson);
    expect(savedMetadata).toEqual({
      selectedSpreadsheetId: "read-sheet",
      selectedSpreadsheetName: "Read Sheet",
      writeDestinationSpreadsheetId: "write-sheet",
      writeDestinationSpreadsheetName: "Write Sheet",
    });
  });

  it("setSelectedSpreadsheet (read) persists WITHOUT touching an existing write destination", async () => {
    findUniqueMock.mockResolvedValue({ metadataJson: JSON.stringify({ writeDestinationSpreadsheetId: "write-sheet", writeDestinationSpreadsheetName: "Write Sheet" }) });
    const { setSelectedSpreadsheet } = await import("../../src/server/google-sheets");
    await setSelectedSpreadsheet("user-1", "read-sheet", "Read Sheet");

    const savedMetadata = JSON.parse(updateMock.mock.calls[0]![0].data.metadataJson);
    expect(savedMetadata).toEqual({
      writeDestinationSpreadsheetId: "write-sheet",
      writeDestinationSpreadsheetName: "Write Sheet",
      selectedSpreadsheetId: "read-sheet",
      selectedSpreadsheetName: "Read Sheet",
    });
  });

  it("getWriteDestinationSpreadsheet reads back a real, previously-configured destination", async () => {
    findUniqueMock.mockResolvedValue({ metadataJson: JSON.stringify({ selectedSpreadsheetId: "read-sheet", writeDestinationSpreadsheetId: "write-sheet", writeDestinationSpreadsheetName: "Write Sheet" }) });
    const { getWriteDestinationSpreadsheet, getSelectedSpreadsheet } = await import("../../src/server/google-sheets");
    expect(await getWriteDestinationSpreadsheet("user-1")).toEqual({ id: "write-sheet", name: "Write Sheet" });
    expect(await getSelectedSpreadsheet("user-1")).toEqual({ id: "read-sheet", name: "" });
  });
});

// WRITE-SCOPE UPGRADE (2026-09-03): a real, live-confirmed defect -- appendSpreadsheetValues() would
// otherwise blindly call the real Sheets API and let Google reject it with a raw 403 for any connection
// still holding its OLD, read-only scope (OAuth scope is fixed at consent time and never retroactively
// upgraded). hasSheetsWriteScope()/appendSpreadsheetValues() now check the connection's own real,
// persisted `scope` string FIRST and fail fast with a clear, actionable reconnect message instead.
describe("hasSheetsWriteScope -- pure, local (zero-network) scope check", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("1: returns true for a scope string that includes the exact write scope", async () => {
    const { hasSheetsWriteScope } = await import("../../src/server/google-sheets");
    expect(hasSheetsWriteScope("https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly")).toBe(true);
  });

  it("2: returns false for the OLD read-only scope -- never confuses '.../spreadsheets.readonly' with '.../spreadsheets'", async () => {
    const { hasSheetsWriteScope } = await import("../../src/server/google-sheets");
    expect(hasSheetsWriteScope("https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly")).toBe(false);
  });

  it("returns false for null/undefined/empty scope, never throws", async () => {
    const { hasSheetsWriteScope } = await import("../../src/server/google-sheets");
    expect(hasSheetsWriteScope(null)).toBe(false);
    expect(hasSheetsWriteScope(undefined)).toBe(false);
    expect(hasSheetsWriteScope("")).toBe(false);
  });

  it("is order-independent and tolerant of the real space-separated scope string format", async () => {
    const { hasSheetsWriteScope } = await import("../../src/server/google-sheets");
    expect(hasSheetsWriteScope("https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets")).toBe(true);
  });
});

describe("SCOPE / buildAuthUrl -- 3: the minimum required, least-privilege scope set", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("3: requests exactly the write Sheets scope + the existing drive.metadata.readonly scope -- nothing broader", async () => {
    const { buildAuthUrl, SHEETS_WRITE_SCOPE } = await import("../../src/server/google-sheets");
    const url = new URL(buildAuthUrl("state-123"));
    const requestedScopes = (url.searchParams.get("scope") ?? "").split(" ");
    expect(requestedScopes).toContain(SHEETS_WRITE_SCOPE);
    expect(requestedScopes).toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
    expect(requestedScopes).toHaveLength(2); // minimal -- no broader Drive/file-management scope added
    expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/drive.file");
    expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/drive");
    expect(requestedScopes.every((s) => !s.endsWith(".readonly") || s.includes("drive.metadata"))).toBe(true); // the Sheets scope itself is no longer read-only
  });

  it("still forces a fresh consent screen on every connect -- the mechanism that makes re-consent possible after this scope upgrade", async () => {
    const { buildAuthUrl } = await import("../../src/server/google-sheets");
    const url = new URL(buildAuthUrl("state-123"));
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("appendSpreadsheetValues -- 5: checks the connection's real, persisted scope before attempting any real API call", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("5/6: throws InsufficientGoogleSheetsScopeError with an actionable reconnect message for an old, read-only-scoped connection -- never calls fetch", async () => {
    findUniqueMock.mockResolvedValue({ scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { appendSpreadsheetValues, InsufficientGoogleSheetsScopeError } = await import("../../src/server/google-sheets");
    await expect(appendSpreadsheetValues("user-1", "sheet-1", "Sheet1!A1", [["a"]])).rejects.toThrow(InsufficientGoogleSheetsScopeError);
    await expect(appendSpreadsheetValues("user-1", "sheet-1", "Sheet1!A1", [["a"]])).rejects.toThrow(/reconnect google sheets/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a clear 'no connection' error, never the scope error, when there is no connection at all", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { appendSpreadsheetValues } = await import("../../src/server/google-sheets");
    await expect(appendSpreadsheetValues("user-1", "sheet-1", "Sheet1!A1", [["a"]])).rejects.toThrow("No Google Sheets connection exists for this user.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds to the real API call for a connection that DOES have the write scope", async () => {
    findUniqueMock.mockResolvedValue({
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly",
      encryptedAccessToken: encryptSecret("valid-access-token"),
      encryptedRefreshToken: encryptSecret("refresh-token"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    const { appendSpreadsheetValues } = await import("../../src/server/google-sheets");
    await appendSpreadsheetValues("user-1", "sheet-1", "Sheet1!A1", [["a"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain(":append?valueInputOption=RAW");
  });
});

// TAB-EXISTENCE FIX FOLLOW-ON (2026-09-03): assertSheetsWriteScope() is the ONE shared, zero-network scope
// gate factored out of appendSpreadsheetValues() so a caller orchestrating MULTIPLE write-capable calls in
// one attempt (spreadsheet-google-sheets-writeback.ts, which now also calls ensureSheetExists()) can check
// scope ONCE, up front, before touching the network at all -- otherwise a known-insufficient-scope
// connection would still make a real (if ultimately pointless) spreadsheets.get read via ensureSheetExists
// before ever reaching appendSpreadsheetValues' own check.
// NAMED-TAB TARGETING (2026-09-21): getAllSpreadsheetValues() must stay 100% backward-compatible (bare,
// unprefixed range) for every existing caller when `sheetName` is omitted, and prefix every batch's range
// with the quoted sheet name when it IS provided -- required to read one of ADASOS's own already-written
// output tabs (e.g. "Admin - Vendor") rather than always whichever tab happens to be first.
describe("getAllSpreadsheetValues -- optional named-tab targeting", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a bare, unprefixed range when sheetName is omitted -- EXACT existing behavior for every current caller", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ values: [["a"]] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    await getAllSpreadsheetValues("user-1", "sheet-1");

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(decodeURIComponent(url)).toContain("/values/A1:Z");
    expect(decodeURIComponent(url)).not.toContain("!");
  });

  it("prefixes every batch range with the quoted sheet name when sheetName is provided", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ values: [["a"]] }) });
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    await getAllSpreadsheetValues("user-1", "sheet-1", { sheetName: "Admin - Vendor" });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(decodeURIComponent(url)).toContain("'Admin - Vendor'!A1:Z");
  });
});

// EXISTING-OUTPUT-TAB CLEAR-AND-REPLACE (2026-09-21): the first real "clear and replace" write in this
// codebase -- clears the named tab's real content, then rewrites it with exactly the header + rows given.
// Same real-token/real-fetch/throw-on-failure/scope-gated shape as appendSpreadsheetValues() above.
describe("clearAndReplaceSheetValues -- the first real clear-and-replace write", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks the connection's real, persisted scope before attempting any real API call -- never calls fetch for an insufficiently-scoped connection", async () => {
    findUniqueMock.mockResolvedValue({ scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { clearAndReplaceSheetValues, InsufficientGoogleSheetsScopeError } = await import("../../src/server/google-sheets");
    await expect(clearAndReplaceSheetValues("user-1", "sheet-1", "Admin - Vendor", ["URL"], [["https://a.com"]])).rejects.toThrow(InsufficientGoogleSheetsScopeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls values.clear on the quoted, whole-tab range, then values.update with the header + data rows -- in that order", async () => {
    findUniqueMock.mockResolvedValue(WRITE_SCOPED_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    const { clearAndReplaceSheetValues } = await import("../../src/server/google-sheets");
    await clearAndReplaceSheetValues("user-1", "sheet-1", "Admin - Vendor", ["URL", "DA"], [["https://a.com", "50"]]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [clearUrl, clearInit] = fetchMock.mock.calls[0]!;
    expect(decodeURIComponent(clearUrl)).toContain("'Admin - Vendor'!A1:Z");
    expect(clearUrl).toContain(":clear");
    expect(clearInit.method).toBe("POST");

    const [updateUrl, updateInit] = fetchMock.mock.calls[1]!;
    expect(decodeURIComponent(updateUrl)).toContain("'Admin - Vendor'!A1");
    expect(updateUrl).toContain("valueInputOption=RAW");
    expect(updateInit.method).toBe("PUT");
    const body = JSON.parse(updateInit.body);
    expect(body.values).toEqual([["URL", "DA"], ["https://a.com", "50"]]);
  });

  it("throws with the full response body when the clear call fails, and never attempts the update call", async () => {
    findUniqueMock.mockResolvedValue(WRITE_SCOPED_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request", text: async () => '{"error":{"message":"Unable to parse range"}}' });
    vi.stubGlobal("fetch", fetchMock);

    const { clearAndReplaceSheetValues } = await import("../../src/server/google-sheets");
    await expect(clearAndReplaceSheetValues("user-1", "sheet-1", "Admin - Vendor", ["URL"], [])).rejects.toThrow(/values\.clear failed: 400 Bad Request.*Unable to parse range/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws with the full response body when the update call fails, after the clear call already succeeded", async () => {
    findUniqueMock.mockResolvedValue(WRITE_SCOPED_CONNECTION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => "{}" })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error", text: async () => '{"error":{"message":"backend error"}}' });
    vi.stubGlobal("fetch", fetchMock);

    const { clearAndReplaceSheetValues } = await import("../../src/server/google-sheets");
    await expect(clearAndReplaceSheetValues("user-1", "sheet-1", "Admin - Vendor", ["URL"], [["https://a.com"]])).rejects.toThrow(/values\.update failed: 500 Internal Server Error.*backend error/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("assertSheetsWriteScope -- the shared, zero-network scope gate", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
  });

  it("throws InsufficientGoogleSheetsScopeError for an old, read-only-scoped connection -- never calls fetch", async () => {
    findUniqueMock.mockResolvedValue({ scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { assertSheetsWriteScope, InsufficientGoogleSheetsScopeError } = await import("../../src/server/google-sheets");
    await expect(assertSheetsWriteScope("user-1")).rejects.toThrow(InsufficientGoogleSheetsScopeError);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("throws a clear 'no connection' error when there is no connection at all", async () => {
    findUniqueMock.mockResolvedValue(null);
    const { assertSheetsWriteScope } = await import("../../src/server/google-sheets");
    await expect(assertSheetsWriteScope("user-1")).rejects.toThrow("No Google Sheets connection exists for this user.");
  });

  it("resolves without throwing for a connection that has the real write scope", async () => {
    findUniqueMock.mockResolvedValue({ scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly" });
    const { assertSheetsWriteScope } = await import("../../src/server/google-sheets");
    await expect(assertSheetsWriteScope("user-1")).resolves.toBeUndefined();
  });
});
