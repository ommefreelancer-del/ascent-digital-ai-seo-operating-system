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

// BATCH READ FIX (2026-09-14): real regression coverage for the confirmed production defect --
// getSpreadsheetValues() alone only ever reads ONE bounded range in ONE call, so any caller using a
// single fixed range (e.g. the old "A1:Z1000") silently missed every row past that bound. A real
// "Health Master Sheet" Sheet1 with 1000+ rows was never read completely. getAllSpreadsheetValues()
// closes this by calling the SAME already-existing getSpreadsheetValues() repeatedly, in real
// successive row-bounded batches, until a batch genuinely returns fewer rows than requested (the real
// signal the Sheets API gives when a range's true data ends before the range's own upper bound) or a
// real, honestly-reported safety ceiling is hit.
describe("getAllSpreadsheetValues", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Simulates the real Sheets API: returns exactly the requested row-bounded slice of `allRows`, which naturally comes back shorter than the batch size once the slice runs past the real data -- the same real signal getAllSpreadsheetValues() relies on to know it has reached the true end. */
  function batchedFetchMock(allRows: string[][]) {
    return vi.fn().mockImplementation(async (url: string) => {
      const match = (url as string).match(/values\/A(\d+)%3AZ(\d+)/);
      const startRow = match ? parseInt(match[1]!, 10) : 1;
      const endRow = match ? parseInt(match[2]!, 10) : Number.MAX_SAFE_INTEGER;
      const slice = allRows.slice(startRow - 1, endRow);
      return { ok: true, text: async () => JSON.stringify({ range: `Sheet1!A${startRow}:Z${endRow}`, majorDimension: "ROWS", values: slice }) };
    });
  }

  it("reads a 1000+ row sheet COMPLETELY across multiple real batches -- proves the exact reported defect (1000+ rows, only 200 ever returned) is fixed", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const header = ["URL", "Status"];
    const rows = [header];
    for (let i = 1; i < 1200; i++) {
      rows.push(i === 600 ? header : [`row-${i}`, "OK"]);
    }
    const fetchMock = batchedFetchMock(rows);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1");

    expect(fetchMock).toHaveBeenCalledTimes(3); // 500 + 500 + 200 -- the real, short final batch is the stop signal
    expect(result.rowsRead).toBe(1200);
    expect(result.batchesRead).toBe(3);
    expect(result.cappedAtSafetyLimit).toBe(false);
    expect(result.values[0]).toEqual(header);
    expect(result.values[600]).toEqual(header); // the repeated header at row 601 (0-indexed 600), verbatim -- never deduplicated
    expect(result.values[1199]).toEqual(["row-1199", "OK"]); // the real last row -- proves nothing was cut off
  });

  it("a small sheet (well under one batch) still reads correctly in a single call", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = batchedFetchMock([["a"], ["b"], ["c"]]);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.rowsRead).toBe(3);
    expect(result.batchesRead).toBe(1);
    expect(result.cappedAtSafetyLimit).toBe(false);
  });

  it("an exact multiple of the batch size still terminates (the following batch legitimately returns zero rows, not an infinite loop)", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const rows = Array.from({ length: 500 }, (_, i) => [`row-${i}`]); // exactly one batch's worth
    const fetchMock = batchedFetchMock(rows);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1");

    expect(fetchMock).toHaveBeenCalledTimes(2); // the full batch, then a real 0-row batch confirming the end
    expect(result.rowsRead).toBe(500);
    expect(result.cappedAtSafetyLimit).toBe(false);
  });

  it("SAFETY CEILING: a sheet that never returns a short batch is still bounded to a deterministic number of real API calls, and honestly reports it was capped", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const endlessRows = Array.from({ length: 1_000_000 }, (_, i) => [`row-${i}`]);
    const fetchMock = batchedFetchMock(endlessRows);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1");

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
    expect(result.rowsRead).toBe(5000);
    expect(result.cappedAtSafetyLimit).toBe(true);
  });

  it("an empty sheet (zero rows) is reported honestly, real single call, never capped", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = batchedFetchMock([]);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.rowsRead).toBe(0);
    expect(result.values).toEqual([]);
    expect(result.cappedAtSafetyLimit).toBe(false);
  });

  it("propagates a real upstream failure honestly -- never silently returns a partial/empty result on a genuine API error", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", text: async () => '{"error":{"message":"insufficient permission"}}' }),
    );

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    await expect(getAllSpreadsheetValues("user-1", "sheet-1")).rejects.toThrow(/Sheets spreadsheets\.values\.get failed: 403 Forbidden.*insufficient permission/);
  });

  // MAX-ROWS OVERRIDE (2026-09-14): real regression coverage for the confirmed follow-on defect -- the
  // AI Workspace agent could still only ever receive up to ~5,000 rows (this function's own default
  // ceiling, tuned for "safe to embed verbatim in an LLM prompt"). Server-side deterministic processing
  // (google-sheets-cleaning.ts) never embeds raw rows in a prompt at all, so it needs a genuinely higher
  // ceiling to read a real "Health Master Sheet" (reported 5,000+ rows) to its true end. `maxTotalRows`
  // is an OPTIONAL override -- omitting it (every existing caller) preserves the exact original 5,000-row
  // behavior unchanged.
  it("maxTotalRows override: a caller that opts into a higher ceiling reads past the default 5,000-row cap", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const rows = Array.from({ length: 7000 }, (_, i) => [`row-${i}`]);
    const fetchMock = batchedFetchMock(rows);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1", { maxTotalRows: 10_000 });

    expect(result.rowsRead).toBe(7000); // past the OLD 5,000 default -- proves the override genuinely takes effect
    expect(result.cappedAtSafetyLimit).toBe(false); // real end of data (a short final batch), not the override ceiling either
  });

  it("maxTotalRows omitted: preserves the EXACT original 5,000-row default for every existing caller, unchanged", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const endlessRows = Array.from({ length: 1_000_000 }, (_, i) => [`row-${i}`]);
    const fetchMock = batchedFetchMock(endlessRows);
    vi.stubGlobal("fetch", fetchMock);

    const { getAllSpreadsheetValues } = await import("../../src/server/google-sheets");
    const result = await getAllSpreadsheetValues("user-1", "sheet-1"); // no options -- same call shape as every existing caller

    expect(result.rowsRead).toBe(5000);
    expect(result.cappedAtSafetyLimit).toBe(true);
  });
});
