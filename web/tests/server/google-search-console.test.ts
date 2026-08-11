import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    googleSearchConsoleConnection: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

const VALID_CONNECTION = {
  userId: "user-1",
  accessToken: "valid-access-token",
  refreshToken: "refresh-token",
  scope: "https://www.googleapis.com/auth/webmasters.readonly",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

describe("inspectUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the real urlInspection.index.inspect endpoint with the connection's access token", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          inspectionResult: {
            inspectionResultLink: "https://search.google.com/search-console/inspect?...",
            indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" },
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { inspectUrl } = await import("../../src/server/google-search-console");
    const result = await inspectUrl("user-1", "https://example.com/", "https://example.com/page");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer valid-access-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      inspectionUrl: "https://example.com/page",
      siteUrl: "https://example.com/",
    });
    expect(result.indexStatusResult?.verdict).toBe("PASS");
    expect(result.indexStatusResult?.coverageState).toBe("Submitted and indexed");
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

    const { inspectUrl } = await import("../../src/server/google-search-console");
    await expect(inspectUrl("user-1", "https://example.com/", "https://example.com/page")).rejects.toThrow(
      /urlInspection\.index\.inspect failed: 403 Forbidden.*does not have permission/,
    );
  });

  it("throws when there is no Search Console connection for the user", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { inspectUrl } = await import("../../src/server/google-search-console");
    await expect(inspectUrl("user-1", "https://example.com/", "https://example.com/page")).rejects.toThrow(
      "No Google Search Console connection exists for this user.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
