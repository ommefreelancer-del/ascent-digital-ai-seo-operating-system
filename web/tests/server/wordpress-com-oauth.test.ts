import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.WPCOM_CLIENT_ID = "test-client-id";
  process.env.WPCOM_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("buildWordPressComAuthUrl", () => {
  it("builds the real WordPress.com OAuth2 authorize URL with the documented parameters", async () => {
    const { buildWordPressComAuthUrl } = await import("../../src/server/wordpress-com-oauth");
    const url = buildWordPressComAuthUrl({ redirectUri: "https://app.test/callback", state: "abc123" });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://public-api.wordpress.com/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.test/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("abc123");
  });
});

describe("exchangeWordPressComCodeForToken", () => {
  it("POSTs to the real token endpoint with the documented grant parameters and returns the real token response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ access_token: "real-token", token_type: "bearer", blog_id: "123", blog_url: "https://example.wordpress.com" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeWordPressComCodeForToken } = await import("../../src/server/wordpress-com-oauth");
    const result = await exchangeWordPressComCodeForToken("real-code", "https://app.test/callback");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://public-api.wordpress.com/oauth2/token");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("code")).toBe("real-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("https://app.test/callback");
    expect(result).toEqual({ access_token: "real-token", token_type: "bearer", blog_id: "123", blog_url: "https://example.wordpress.com" });
  });

  it("throws with the real response body when WordPress.com rejects the code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":"invalid_request"}' }));

    const { exchangeWordPressComCodeForToken } = await import("../../src/server/wordpress-com-oauth");
    await expect(exchangeWordPressComCodeForToken("bad-code", "https://app.test/callback")).rejects.toThrow(/invalid_request/);
  });
});
