import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

describe("fetchHtmlWithDetails", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns the HTML, status, and a single-entry redirect chain for a direct 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>hi</body></html>", { status: 200 })),
    );
    const { fetchHtmlWithDetails } = await import("../../../src/core/crawling/fetch-html.js");
    const result = await fetchHtmlWithDetails("http://public.example.com/page");
    expect(result.status).toBe(200);
    expect(result.html).toContain("hi");
    expect(result.finalUrl).toBe("http://public.example.com/page");
    expect(result.redirectChain).toEqual(["http://public.example.com/page"]);
  });

  it("captures real response headers with lower-cased keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html></html>", {
            status: 200,
            headers: { "Content-Type": "text/html", "X-Content-Type-Options": "nosniff" },
          }),
      ),
    );
    const { fetchHtmlWithDetails } = await import("../../../src/core/crawling/fetch-html.js");
    const result = await fetchHtmlWithDetails("http://public.example.com/page");
    expect(result.headers["content-type"]).toBe("text/html");
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("captures headers from the final hop only, after following redirects", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href === "http://public.example.com/old") {
        return new Response(null, {
          status: 301,
          headers: { location: "http://public.example.com/new", "x-frame-options": "SHOULD-NOT-APPEAR" },
        });
      }
      return new Response("<html>final</html>", { status: 200, headers: { "x-frame-options": "DENY" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchHtmlWithDetails } = await import("../../../src/core/crawling/fetch-html.js");
    const result = await fetchHtmlWithDetails("http://public.example.com/old");
    expect(result.headers["x-frame-options"]).toBe("DENY");
  });

  it("follows a redirect chain and re-validates each hop", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href === "http://public.example.com/old") {
        return new Response(null, { status: 301, headers: { location: "http://public.example.com/new" } });
      }
      return new Response("<html>final</html>", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchHtmlWithDetails } = await import("../../../src/core/crawling/fetch-html.js");
    const result = await fetchHtmlWithDetails("http://public.example.com/old");
    expect(result.finalUrl).toBe("http://public.example.com/new");
    expect(result.redirectChain).toEqual(["http://public.example.com/old", "http://public.example.com/new"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws FetchHtmlError on a redirect with no Location header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
    const { fetchHtmlWithDetails, FetchHtmlError } = await import("../../../src/core/crawling/fetch-html.js");
    await expect(fetchHtmlWithDetails("http://public.example.com/broken")).rejects.toBeInstanceOf(FetchHtmlError);
  });

  it("throws FetchHtmlError with the real status on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const { fetchHtmlWithDetails, FetchHtmlError } = await import("../../../src/core/crawling/fetch-html.js");
    await expect(fetchHtmlWithDetails("http://public.example.com/missing")).rejects.toMatchObject({
      status: 404,
    } as Partial<InstanceType<typeof FetchHtmlError>>);
  });

  it("throws after exceeding the maximum redirect count", async () => {
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        return new Response(null, { status: 302, headers: { location: `http://public.example.com/hop-${hop}` } });
      }),
    );
    const { fetchHtmlWithDetails } = await import("../../../src/core/crawling/fetch-html.js");
    await expect(fetchHtmlWithDetails("http://public.example.com/start")).rejects.toThrow("Too many redirects");
  });
});
