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
