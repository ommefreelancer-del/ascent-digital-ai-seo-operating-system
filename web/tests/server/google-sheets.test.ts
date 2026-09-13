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

const VALID_CONNECTION = {
  userId: "user-1",
  service: "sheets",
  accessToken: "valid-access-token",
  refreshToken: "refresh-token",
  scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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
  // defect -- a real user's newly-created spreadsheet never appeared anywhere in the Settings
  // selectors. Two real, provable code-level gaps: (J) only the first Drive results page was ever
  // fetched (no pageToken follow-up), and (corpus) the query never asked Drive to include Shared
  // Drive-resident files. Neither fix touches OAuth scope -- same drive.metadata.readonly token
  // throughout.

  it("J: follows Drive's nextPageToken until exhausted -- a spreadsheet on page 2+ (e.g. beyond the first 100 by modifiedTime) is never silently dropped", async () => {
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
