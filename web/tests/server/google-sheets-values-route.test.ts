// READ-SELECTOR PERSISTENCE FIX (2026-09-13): real behavioral coverage of api/integrations/google-sheets/
// values/route.ts's new GET handler -- the counterpart to write-destination/route.ts's own GET, added
// because Settings -> Integrations previously had no way to restore a user's explicit "Read a spreadsheet"
// selection on page load, so it fell back to auto-selecting whatever the Drive list returned first. Also
// covers the existing POST's real ownership check (a spreadsheet must appear in the user's OWN fresh
// listSpreadsheets() result before its selection is persisted -- I, at the server layer). Route handlers
// are plain exported async functions invokable directly under Node/vitest with no server; the two real
// network-touching pieces (auth session + Drive API via listSpreadsheets) are mocked -- zero real network
// calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockUserId: string | null = null;
vi.mock("@/server/auth", () => ({
  getServerAuthSession: () => Promise.resolve(mockUserId ? { user: { id: mockUserId, email: "test@example.com" } } : null),
}));

const getSpreadsheetValuesMock = vi.fn();
const setSelectedSpreadsheetMock = vi.fn();
const getSelectedSpreadsheetMock = vi.fn();
const listSpreadsheetsMock = vi.fn();
vi.mock("@/server/google-sheets", () => ({
  getSpreadsheetValues: (...args: unknown[]) => getSpreadsheetValuesMock(...args),
  setSelectedSpreadsheet: (...args: unknown[]) => setSelectedSpreadsheetMock(...args),
  getSelectedSpreadsheet: (...args: unknown[]) => getSelectedSpreadsheetMock(...args),
  listSpreadsheets: (...args: unknown[]) => listSpreadsheetsMock(...args),
}));

const { GET, POST } = await import("../../src/app/api/integrations/google-sheets/values/route");

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/integrations/google-sheets/values", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId = "user-1";
});

afterEach(() => {
  getSpreadsheetValuesMock.mockReset();
  setSelectedSpreadsheetMock.mockReset();
  getSelectedSpreadsheetMock.mockReset();
  listSpreadsheetsMock.mockReset();
});

describe("GET /api/integrations/google-sheets/values -- G: restores the persisted read selection so a page refresh preserves the user's explicit choice", () => {
  it("requires a real authenticated session", async () => {
    mockUserId = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getSelectedSpreadsheetMock).not.toHaveBeenCalled();
  });

  it("D: returns the persisted selection when the user previously selected Health Master", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "health-master-id", name: "Health Master" });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ selected: { id: "health-master-id", name: "Health Master" } });
    expect(getSelectedSpreadsheetMock).toHaveBeenCalledWith("user-1");
  });

  it("E: returns the persisted selection when the user previously selected Admin Sheet Health", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue({ id: "admin-sheet-health-id", name: "Admin Sheet Health" });
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ selected: { id: "admin-sheet-health-id", name: "Admin Sheet Health" } });
  });

  it("returns null when nothing has ever been explicitly selected -- never fabricates a default", async () => {
    getSelectedSpreadsheetMock.mockResolvedValue(null);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ selected: null });
  });
});

describe("POST /api/integrations/google-sheets/values -- persists the read selection only when it matches a real, owned spreadsheet", () => {
  it("requires a real authenticated session", async () => {
    mockUserId = null;
    const res = await POST(postRequest({ spreadsheetId: "sheet-1", range: "A1:B2" }));
    expect(res.status).toBe(401);
    expect(getSpreadsheetValuesMock).not.toHaveBeenCalled();
  });

  it("D: reading Health Master persists Health Master's id as the selection", async () => {
    getSpreadsheetValuesMock.mockResolvedValue({ range: "A1:B2", majorDimension: "ROWS", values: [["a"]] });
    listSpreadsheetsMock.mockResolvedValue([
      { id: "admin-sheet-health-id", name: "Admin Sheet Health" },
      { id: "health-master-id", name: "Health Master" },
    ]);
    const res = await POST(postRequest({ spreadsheetId: "health-master-id", range: "A1:B2" }));
    expect(res.status).toBe(200);
    expect(setSelectedSpreadsheetMock).toHaveBeenCalledWith("user-1", "health-master-id", "Health Master");
  });

  it("E: reading Admin Sheet Health persists Admin Sheet Health's id as the selection", async () => {
    getSpreadsheetValuesMock.mockResolvedValue({ range: "A1:B2", majorDimension: "ROWS", values: [["a"]] });
    listSpreadsheetsMock.mockResolvedValue([
      { id: "admin-sheet-health-id", name: "Admin Sheet Health" },
      { id: "health-master-id", name: "Health Master" },
    ]);
    const res = await POST(postRequest({ spreadsheetId: "admin-sheet-health-id", range: "A1:B2" }));
    expect(res.status).toBe(200);
    expect(setSelectedSpreadsheetMock).toHaveBeenCalledWith("user-1", "admin-sheet-health-id", "Admin Sheet Health");
  });

  it("I: never persists a spreadsheet id that isn't in the user's own fresh Drive listing -- the real read result still succeeds, but no selection is silently recorded", async () => {
    getSpreadsheetValuesMock.mockResolvedValue({ range: "A1:B2", majorDimension: "ROWS", values: [] });
    listSpreadsheetsMock.mockResolvedValue([{ id: "sheet-1", name: "My Sheet" }]);
    const res = await POST(postRequest({ spreadsheetId: "no-longer-accessible-id", range: "A1:B2" }));
    expect(res.status).toBe(200);
    expect(setSelectedSpreadsheetMock).not.toHaveBeenCalled();
  });

  it("K: two spreadsheets with the same name are distinguished by id -- selecting one never persists the other's id", async () => {
    getSpreadsheetValuesMock.mockResolvedValue({ range: "A1:B2", majorDimension: "ROWS", values: [] });
    listSpreadsheetsMock.mockResolvedValue([
      { id: "report-a", name: "Report" },
      { id: "report-b", name: "Report" },
    ]);
    const res = await POST(postRequest({ spreadsheetId: "report-b", range: "A1:B2" }));
    expect(res.status).toBe(200);
    expect(setSelectedSpreadsheetMock).toHaveBeenCalledWith("user-1", "report-b", "Report");
    expect(setSelectedSpreadsheetMock).not.toHaveBeenCalledWith("user-1", "report-a", expect.anything());
  });

  it("L: an upstream Drive/Sheets failure surfaces only a generic error message, never a raw token or credential value", async () => {
    getSpreadsheetValuesMock.mockRejectedValue(new Error("Sheets spreadsheets.values.get failed: 401 Unauthorized"));
    const res = await POST(postRequest({ spreadsheetId: "sheet-1", range: "A1:B2" }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).not.toMatch(/bearer|access_token|refresh_token/i);
  });
});
