import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, upsertMock, updateMock, deleteMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    wordPressConnection: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
      update: updateMock,
      delete: deleteMock,
    },
  },
}));

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json", ...(headers ?? {}) }),
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

const VALID_CONNECTION = {
  userId: "user-1",
  provider: "self-hosted",
  siteUrl: "https://example.com",
  username: "editor",
  appPassword: "abcd 1234 efgh 5678",
  accessToken: null,
  wpcomSiteId: null,
  siteName: "Example Site",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const AUTHORIZATION_INDEX = {
  name: "Example Site",
  description: "Just another WordPress site",
  url: "https://example.com",
  authentication: {
    "application-passwords": { endpoints: { authorization: "https://example.com/wp-admin/authorize-application.php" } },
  },
};

beforeEach(() => {
  vi.resetModules();
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  process.env.WPCOM_CLIENT_ID = "test-client-id";
  process.env.WPCOM_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildAuthorizeUrl", () => {
  it("builds the real wp-admin/authorize-application.php URL when the site advertises Application Passwords support", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, AUTHORIZATION_INDEX));
    vi.stubGlobal("fetch", fetchMock);

    const { buildAuthorizeUrl } = await import("../../src/server/wordpress");
    const result = await buildAuthorizeUrl("example.com", "https://app.test/callback", "https://app.test/callback?rejected=1");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/wp-json/", expect.any(Object));
    expect(result.siteUrl).toBe("https://example.com");
    expect(result.authorizeUrl.startsWith("https://example.com/wp-admin/authorize-application.php?")).toBe(true);
    const authorizeParams = new URL(result.authorizeUrl).searchParams;
    expect(authorizeParams.get("app_name")).toBe("ADASOS");
    expect(authorizeParams.get("success_url")).toBe("https://app.test/callback");
    expect(authorizeParams.get("reject_url")).toBe("https://app.test/callback?rejected=1");
  });

  it("throws WordPressInvalidSiteError when the site doesn't advertise Application Passwords support", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { name: "Old WordPress Site" })));

    const { buildAuthorizeUrl, WordPressInvalidSiteError } = await import("../../src/server/wordpress");
    await expect(buildAuthorizeUrl("example.com", "https://app.test/callback", "https://app.test/callback")).rejects.toBeInstanceOf(
      WordPressInvalidSiteError,
    );
  });

  it("throws WordPressInvalidSiteError for a malformed site URL, without ever calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { buildAuthorizeUrl, WordPressInvalidSiteError } = await import("../../src/server/wordpress");
    await expect(buildAuthorizeUrl("not a valid url", "https://app.test/callback", "https://app.test/callback")).rejects.toBeInstanceOf(
      WordPressInvalidSiteError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws WordPressInvalidSiteError when the site is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const { buildAuthorizeUrl, WordPressInvalidSiteError } = await import("../../src/server/wordpress");
    await expect(buildAuthorizeUrl("unreachable.example", "https://app.test/callback", "https://app.test/callback")).rejects.toBeInstanceOf(
      WordPressInvalidSiteError,
    );
  });

  it("throws WordPressInvalidSiteError when the URL doesn't return a WordPress REST index (non-JSON response)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html>not wordpress</html>",
      }),
    );

    const { buildAuthorizeUrl, WordPressInvalidSiteError } = await import("../../src/server/wordpress");
    await expect(buildAuthorizeUrl("not-wordpress.example", "https://app.test/callback", "https://app.test/callback")).rejects.toBeInstanceOf(
      WordPressInvalidSiteError,
    );
  });
});

describe("saveConnectionFromAuthorize", () => {
  it("verifies the returned credentials via a real API call before storing them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: 1, name: "Editor" })) // verifyCredentials
      .mockResolvedValueOnce(jsonResponse(200, AUTHORIZATION_INDEX)); // discoverSite for siteName
    vi.stubGlobal("fetch", fetchMock);
    upsertMock.mockResolvedValue({});

    const { saveConnectionFromAuthorize } = await import("../../src/server/wordpress");
    await saveConnectionFromAuthorize("user-1", "https://example.com", "editor", "abcd 1234 efgh 5678");

    const [verifyUrl, verifyInit] = fetchMock.mock.calls[0]!;
    expect(verifyUrl).toBe("https://example.com/wp-json/wp/v2/users/me?context=edit");
    expect(verifyInit.headers.Authorization).toBe(`Basic ${Buffer.from("editor:abcd 1234 efgh 5678").toString("base64")}`);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        create: expect.objectContaining({ userId: "user-1", siteUrl: "https://example.com", username: "editor", appPassword: "abcd 1234 efgh 5678" }),
      }),
    );
  });

  it("throws WordPressAuthError and never stores anything when WordPress rejects the credentials (401)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, "Invalid credentials")));

    const { saveConnectionFromAuthorize, WordPressAuthError } = await import("../../src/server/wordpress");
    await expect(saveConnectionFromAuthorize("user-1", "https://example.com", "editor", "wrong")).rejects.toBeInstanceOf(WordPressAuthError);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("getConnectionStatus", () => {
  it("returns connected:false without calling fetch when there's no stored connection", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result).toEqual({ connected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns connected:true only after a real, live health check against the stored credentials succeeds", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { id: 1, name: "Editor" })));

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result.connected).toBe(true);
    expect(result.siteUrl).toBe("https://example.com");
    expect(result.siteName).toBe("Example Site");
  });

  it("returns connected:false when a stored connection's live health check fails (e.g. the Application Password was since revoked)", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, "Invalid credentials")));

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result.connected).toBe(false);
  });
});

describe("disconnect", () => {
  it("best-effort revokes the Application Password on WordPress itself, then deletes the local row", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { uuid: "abc-123" })) // introspect
      .mockResolvedValueOnce(jsonResponse(200, { deleted: true })); // delete by uuid
    vi.stubGlobal("fetch", fetchMock);
    deleteMock.mockResolvedValue({});

    const { disconnect } = await import("../../src/server/wordpress");
    await disconnect("user-1");

    expect(fetchMock.mock.calls[0]![0]).toBe("https://example.com/wp-json/wp/v2/users/me/application-passwords/introspect");
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1]!;
    expect(deleteUrl).toBe("https://example.com/wp-json/wp/v2/users/me/application-passwords/abc-123");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteMock).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("still deletes the local row even when the remote revoke fails entirely (best-effort, non-fatal)", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    deleteMock.mockResolvedValue({});

    const { disconnect } = await import("../../src/server/wordpress");
    await disconnect("user-1");
    expect(deleteMock).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("does nothing when there's no stored connection", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { disconnect } = await import("../../src/server/wordpress");
    await disconnect("user-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

const RAW_POST = {
  id: 42,
  status: "draft",
  link: "https://example.com/?p=42",
  date: "2026-01-01T00:00:00",
  modified: "2026-01-01T00:00:00",
  title: { rendered: "A Real Draft" },
  excerpt: { rendered: "A real excerpt." },
  featured_media: 0,
};

describe("listContent", () => {
  it("throws WordPressNotConfiguredError when there's no connection for this user", async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { listContent, WordPressNotConfiguredError } = await import("../../src/server/wordpress");
    await expect(listContent("user-1")).rejects.toBeInstanceOf(WordPressNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists real posts (including drafts, via an authenticated context=edit request)", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [RAW_POST]));
    vi.stubGlobal("fetch", fetchMock);

    const { listContent } = await import("../../src/server/wordpress");
    const items = await listContent("user-1", "post", { status: "draft" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://example.com/wp-json/wp/v2/posts?");
    expect(url).toContain("context=edit");
    expect(url).toContain("status=draft");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("editor:abcd 1234 efgh 5678").toString("base64")}`);
    expect(items).toEqual([
      { id: 42, type: "post", status: "draft", title: "A Real Draft", link: "https://example.com/?p=42", excerpt: "A real excerpt.", date: "2026-01-01T00:00:00", modified: "2026-01-01T00:00:00", featuredMediaId: 0 },
    ]);
  });

  it("lists real pages from the /pages endpoint when asked for type=page", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);

    const { listContent } = await import("../../src/server/wordpress");
    const items = await listContent("user-1", "page");
    expect(fetchMock.mock.calls[0]![0]).toContain("https://example.com/wp-json/wp/v2/pages?");
    expect(items).toEqual([]);
  });
});

describe("getContent", () => {
  it("retrieves a single post's real status and permalink", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, RAW_POST)));

    const { getContent } = await import("../../src/server/wordpress");
    const item = await getContent("user-1", 42);
    expect(item.status).toBe("draft");
    expect(item.link).toBe("https://example.com/?p=42");
  });
});

describe("createDraft", () => {
  it("always forces status=draft in the real request body, regardless of what's passed", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, RAW_POST));
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/server/wordpress");
    const result = await createDraft("user-1", { title: "A Real Draft", content: "Real body." });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.status).toBe("draft");
    expect(body.title).toBe("A Real Draft");
    expect(result.status).toBe("draft");
  });
});

describe("updateContent", () => {
  it("sends only the provided fields and never includes status", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...RAW_POST, title: { rendered: "Updated Title" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { updateContent } = await import("../../src/server/wordpress");
    await updateContent("user-1", 42, { title: "Updated Title" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/42");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ title: "Updated Title" });
    expect(body.status).toBeUndefined();
  });

  it("sets featured_media when setFeaturedImage is called", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, RAW_POST));
    vi.stubGlobal("fetch", fetchMock);

    const { setFeaturedImage } = await import("../../src/server/wordpress");
    await setFeaturedImage("user-1", 42, 99);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ featured_media: 99 });
  });
});

describe("publishPost", () => {
  it("is the only path that sets status=publish", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ...RAW_POST, status: "publish" }));
    vi.stubGlobal("fetch", fetchMock);

    const { publishPost } = await import("../../src/server/wordpress");
    const result = await publishPost("user-1", 42);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body).toEqual({ status: "publish" });
    expect(result.status).toBe("publish");
  });
});

describe("deleteContent (cleanup)", () => {
  it("sends a force=true DELETE for permanent cleanup of temporary/test content", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { deleteContent } = await import("../../src/server/wordpress");
    await deleteContent("user-1", 42, "post", true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/42?force=true");
    expect(init.method).toBe("DELETE");
  });
});

describe("uploadMedia", () => {
  it("uploads raw bytes with Content-Type/Content-Disposition headers and returns the normalized result", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 7, source_url: "https://example.com/wp-content/uploads/photo.jpg" }));
    vi.stubGlobal("fetch", fetchMock);

    const { uploadMedia } = await import("../../src/server/wordpress");
    const result = await uploadMedia("user-1", { filename: "photo.jpg", mimeType: "image/jpeg", data: Buffer.from([1, 2, 3]) });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.com/wp-json/wp/v2/media");
    expect(init.headers["Content-Type"]).toBe("image/jpeg");
    expect(init.headers["Content-Disposition"]).toBe('attachment; filename="photo.jpg"');
    expect(result).toEqual({ id: 7, sourceUrl: "https://example.com/wp-content/uploads/photo.jpg" });
  });

  it("sets alt text with a follow-up request when provided", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { id: 7, source_url: "https://example.com/wp-content/uploads/photo.jpg" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    const { uploadMedia } = await import("../../src/server/wordpress");
    await uploadMedia("user-1", { filename: "photo.jpg", mimeType: "image/jpeg", data: Buffer.from([1]), altText: "A real photo" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [altUrl, altInit] = fetchMock.mock.calls[1]!;
    expect(altUrl).toBe("https://example.com/wp-json/wp/v2/media/7");
    expect(JSON.parse(altInit.body)).toEqual({ alt_text: "A real photo" });
  });
});

describe("permission failures", () => {
  it("throws WordPressPermissionError on 403 without retrying", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { message: "Sorry, you are not allowed to do that." }));
    vi.stubGlobal("fetch", fetchMock);

    const { listContent, WordPressPermissionError } = await import("../../src/server/wordpress");
    await expect(listContent("user-1")).rejects.toBeInstanceOf(WordPressPermissionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("API errors and timeouts", () => {
  it("retries a 5xx failure and succeeds on the next attempt", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(500, "Internal Server Error")).mockResolvedValueOnce(jsonResponse(200, [RAW_POST]));
    vi.stubGlobal("fetch", fetchMock);

    const { listContent } = await import("../../src/server/wordpress");
    const items = await listContent("user-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
  }, 10_000);

  it("throws WordPressApiError after exhausting retries against a persistent 5xx", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, "Service Unavailable")));

    const { listContent, WordPressApiError } = await import("../../src/server/wordpress");
    await expect(listContent("user-1")).rejects.toBeInstanceOf(WordPressApiError);
  }, 10_000);

  it("throws WordPressApiError with a timeout message when the request is aborted", async () => {
    findUniqueMock.mockResolvedValue(VALID_CONNECTION);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        return Promise.reject(err);
      }),
    );

    const { listContent, WordPressApiError } = await import("../../src/server/wordpress");
    await expect(listContent("user-1")).rejects.toMatchObject({ message: expect.stringContaining("timed out") } as Partial<InstanceType<typeof WordPressApiError>>);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// WordPress.com (OAuth2) provider
// ---------------------------------------------------------------------------

const WPCOM_CONNECTION = {
  userId: "user-1",
  provider: "wordpress-com",
  siteUrl: "https://myblog.wordpress.com",
  siteName: "My Blog",
  username: null,
  appPassword: null,
  accessToken: "wpcom-access-token",
  wpcomSiteId: "999",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const WPCOM_SITE_RAW_1 = { ID: 111, URL: "https://siteone.wordpress.com", name: "Site One" };
const WPCOM_SITE_RAW_2 = { ID: 222, URL: "https://sitetwo.wordpress.com", name: "Site Two" };

function tokenResponse() {
  return jsonResponse(200, { access_token: "wpcom-access-token", token_type: "bearer" });
}

describe("exchangeWordPressComCodeAndSaveConnection", () => {
  it("auto-selects the site when the account manages exactly one", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, { sites: [WPCOM_SITE_RAW_1] }));
    vi.stubGlobal("fetch", fetchMock);
    upsertMock.mockResolvedValue({});

    const { exchangeWordPressComCodeAndSaveConnection } = await import("../../src/server/wordpress");
    const result = await exchangeWordPressComCodeAndSaveConnection("user-1", "real-code", "https://app.test/callback");

    expect(result.siteSelected).toBe(true);
    expect(result.sites).toEqual([{ id: "111", url: "https://siteone.wordpress.com", name: "Site One" }]);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: "user-1", provider: "wordpress-com", wpcomSiteId: "111", siteUrl: "https://siteone.wordpress.com", accessToken: "wpcom-access-token" }),
      }),
    );
  });

  it("saves the token but leaves no site selected when the account manages more than one site", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, { sites: [WPCOM_SITE_RAW_1, WPCOM_SITE_RAW_2] }));
    vi.stubGlobal("fetch", fetchMock);
    upsertMock.mockResolvedValue({});

    const { exchangeWordPressComCodeAndSaveConnection } = await import("../../src/server/wordpress");
    const result = await exchangeWordPressComCodeAndSaveConnection("user-1", "real-code", "https://app.test/callback");

    expect(result.siteSelected).toBe(false);
    expect(result.sites).toHaveLength(2);
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ wpcomSiteId: null, accessToken: "wpcom-access-token" }) }));
  });

  it("still saves the connection when the account has zero sites (not an error)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse(200, { sites: [] }));
    vi.stubGlobal("fetch", fetchMock);
    upsertMock.mockResolvedValue({});

    const { exchangeWordPressComCodeAndSaveConnection } = await import("../../src/server/wordpress");
    const result = await exchangeWordPressComCodeAndSaveConnection("user-1", "real-code", "https://app.test/callback");
    expect(result.siteSelected).toBe(false);
    expect(result.sites).toEqual([]);
    expect(upsertMock).toHaveBeenCalled();
  });
});

describe("listWordPressComSites / selectWordPressComSite", () => {
  it("lists the account's real sites via a live /me/sites call", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sites: [WPCOM_SITE_RAW_1, WPCOM_SITE_RAW_2] }));
    vi.stubGlobal("fetch", fetchMock);

    const { listWordPressComSites } = await import("../../src/server/wordpress");
    const sites = await listWordPressComSites("user-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://public-api.wordpress.com/rest/v1.1/me/sites");
    expect(init.headers.Authorization).toBe("Bearer wpcom-access-token");
    expect(sites).toEqual([
      { id: "111", url: "https://siteone.wordpress.com", name: "Site One" },
      { id: "222", url: "https://sitetwo.wordpress.com", name: "Site Two" },
    ]);
  });

  it("throws WordPressNotConfiguredError when there's no wordpress-com connection", async () => {
    findUniqueMock.mockResolvedValue(null);
    const { listWordPressComSites, WordPressNotConfiguredError } = await import("../../src/server/wordpress");
    await expect(listWordPressComSites("user-1")).rejects.toBeInstanceOf(WordPressNotConfiguredError);
  });

  it("selects a real site from the account's own list and updates the connection", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { sites: [WPCOM_SITE_RAW_1, WPCOM_SITE_RAW_2] })));
    updateMock.mockResolvedValue({});

    const { selectWordPressComSite } = await import("../../src/server/wordpress");
    const site = await selectWordPressComSite("user-1", "222");

    expect(site).toEqual({ id: "222", url: "https://sitetwo.wordpress.com", name: "Site Two" });
    expect(updateMock).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { siteUrl: "https://sitetwo.wordpress.com", siteName: "Site Two", wpcomSiteId: "222" } });
  });

  it("throws WordPressInvalidSiteError when the given site id isn't in the account's real site list", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { sites: [WPCOM_SITE_RAW_1] })));

    const { selectWordPressComSite, WordPressInvalidSiteError } = await import("../../src/server/wordpress");
    await expect(selectWordPressComSite("user-1", "does-not-exist")).rejects.toBeInstanceOf(WordPressInvalidSiteError);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("getConnectionStatus (wordpress-com)", () => {
  it("reports needsSiteSelection when the token is valid but no site has been chosen yet", async () => {
    findUniqueMock.mockResolvedValue({ ...WPCOM_CONNECTION, wpcomSiteId: null, siteUrl: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ID: 1, display_name: "Test User" })));

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result).toEqual({ connected: false, provider: "wordpress-com", needsSiteSelection: true });
  });

  it("reports connected:true after a real, live call against the selected site succeeds", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ID: 999, name: "My Blog" })));

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result.connected).toBe(true);
    expect(result.provider).toBe("wordpress-com");
    expect(result.siteName).toBe("My Blog");
  });

  it("reports connected:false when the access token no longer works", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, "Invalid token")));

    const { getConnectionStatus } = await import("../../src/server/wordpress");
    const result = await getConnectionStatus("user-1");
    expect(result.connected).toBe(false);
  });
});

describe("disconnect (wordpress-com)", () => {
  it("only removes the local row -- no remote revoke call, since WordPress.com has no documented public revoke endpoint", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    deleteMock.mockResolvedValue({});

    const { disconnect } = await import("../../src/server/wordpress");
    await disconnect("user-1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deleteMock).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });
});

describe("content operations via the wordpress-com provider", () => {
  it("lists real posts through WordPress.com's wp/v2 proxy using a Bearer token", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [RAW_POST]));
    vi.stubGlobal("fetch", fetchMock);

    const { listContent } = await import("../../src/server/wordpress");
    const items = await listContent("user-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("https://public-api.wordpress.com/wp/v2/sites/999/posts?");
    expect(init.headers.Authorization).toBe("Bearer wpcom-access-token");
    expect(items).toHaveLength(1);
  });

  it("throws WordPressSiteNotSelectedError for content operations when a wordpress-com account has no site chosen yet", async () => {
    findUniqueMock.mockResolvedValue({ ...WPCOM_CONNECTION, wpcomSiteId: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { listContent, WordPressSiteNotSelectedError } = await import("../../src/server/wordpress");
    await expect(listContent("user-1")).rejects.toBeInstanceOf(WordPressSiteNotSelectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a draft through the wordpress-com proxy, still forcing status=draft", async () => {
    findUniqueMock.mockResolvedValue(WPCOM_CONNECTION);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, RAW_POST));
    vi.stubGlobal("fetch", fetchMock);

    const { createDraft } = await import("../../src/server/wordpress");
    await createDraft("user-1", { title: "A Real Draft", content: "Real body." });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://public-api.wordpress.com/wp/v2/sites/999/posts");
    expect(JSON.parse(init.body).status).toBe("draft");
  });
});
