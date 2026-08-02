import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const PAGES: Record<string, { status: number; body: string; headers?: Record<string, string> }> = {
  "http://public.example.com/robots.txt": {
    status: 200,
    body: "User-agent: *\nDisallow: /private\nSitemap: http://public.example.com/sitemap.xml",
  },
  "http://public.example.com/sitemap.xml": {
    status: 200,
    body: `<urlset><url><loc>http://public.example.com/</loc></url><url><loc>http://public.example.com/from-sitemap/</loc></url></urlset>`,
  },
  "http://public.example.com/": {
    status: 200,
    body: `<html><body>
      <a href="/about/">About</a>
      <a href="/private/secret">Secret</a>
      <a href="http://other.example.com/">External</a>
    </body></html>`,
    headers: { "content-security-policy": "default-src 'self'" },
  },
  "http://public.example.com/about/": { status: 200, body: "<html><body>About page</body></html>" },
  "http://public.example.com/from-sitemap/": { status: 200, body: "<html><body>From sitemap</body></html>" },
};

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = url.toString();
      const page = PAGES[href];
      if (!page) return new Response("not found", { status: 404 });
      return page.headers
        ? new Response(page.body, { status: page.status, headers: page.headers })
        : new Response(page.body, { status: page.status });
    }),
  );
}

// Fixture for www/non-www origin-normalization regression tests: robots.txt
// (served on the www host, since fetch URLs are still built from the real,
// non-normalized seed origin) points to a sitemap on the NON-www host --
// mirroring real sites like openai.com that redirect www -> non-www and
// publish their sitemap on the post-redirect host.
const WWW_PAGES: Record<string, { status: number; body: string }> = {
  "https://www.acme-test.example/robots.txt": {
    status: 200,
    body: "User-agent: *\nSitemap: https://acme-test.example/sitemap.xml",
  },
  "https://acme-test.example/sitemap.xml": {
    status: 200,
    body: `<urlset><url><loc>https://acme-test.example/from-sitemap/</loc></url></urlset>`,
  },
  "https://www.acme-test.example/": {
    status: 200,
    body: `<html><body>
      <a href="https://acme-test.example/linked-page/">Linked (non-www)</a>
      <a href="https://blog.acme-test.example/">Different subdomain</a>
      <a href="https://evil.example/">Genuinely external</a>
    </body></html>`,
  },
  "https://acme-test.example/from-sitemap/": { status: 200, body: "<html><body>From sitemap (non-www)</body></html>" },
  "https://acme-test.example/linked-page/": { status: 200, body: "<html><body>Linked (non-www)</body></html>" },
};

function installWwwFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = url.toString();
      const page = WWW_PAGES[href];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page.body, { status: page.status });
    }),
  );
}

describe("crawlWebsite -- www/non-www origin normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("treats www.example.com and example.com as the same site when following links", async () => {
    installWwwFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://www.acme-test.example/");

    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("https://www.acme-test.example/");
    expect(urls).toContain("https://acme-test.example/linked-page/");
  });

  it("does not discard sitemap URLs because of a www/non-www difference from the seed URL", async () => {
    installWwwFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://www.acme-test.example/");

    // The sitemap itself was discovered and parsed...
    expect(result.sitemapUrls).toContain("https://acme-test.example/from-sitemap/");
    // ...and, critically, its non-www URL was actually queued and crawled,
    // not silently dropped by the same-origin filter.
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("https://acme-test.example/from-sitemap/");
  });

  it("still excludes genuinely different hosts, including other subdomains -- only a literal www. prefix is normalized", async () => {
    installWwwFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://www.acme-test.example/");

    const urls = result.pages.map((p) => p.url);
    expect(urls.some((u) => u.includes("evil.example"))).toBe(false);
    expect(urls.some((u) => u.includes("blog.acme-test.example"))).toBe(false);
  });
});

describe("crawlWebsite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("crawls internal pages discovered via links and via the sitemap, respecting robots.txt", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/");

    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("http://public.example.com/");
    expect(urls).toContain("http://public.example.com/about/");
    expect(urls).toContain("http://public.example.com/from-sitemap/");

    // The external link must never be queued/fetched.
    expect(urls.some((u) => u.includes("other.example.com"))).toBe(false);

    // The robots-disallowed path is recorded but never actually fetched.
    const blocked = result.pages.find((p) => p.url === "http://public.example.com/private/secret");
    expect(blocked).toBeDefined();
    expect(blocked?.error).toMatch(/robots\.txt/i);
    expect(blocked?.html).toBeNull();

    expect(result.robotsTxt?.groups).toHaveLength(1);
    expect(result.sitemapUrls).toContain("http://public.example.com/from-sitemap/");
  });

  it("carries real response headers through to each successfully-fetched page, and null for pages that were never fetched", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/");

    const start = result.pages.find((p) => p.url === "http://public.example.com/");
    expect(start?.headers?.["content-security-policy"]).toBe("default-src 'self'");

    const blocked = result.pages.find((p) => p.url === "http://public.example.com/private/secret");
    expect(blocked?.headers).toBeNull();
  });

  it("fetches disallowed paths when respectRobotsTxt is false", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    // /private/secret has no fixture entry, so it will 404 rather than being
    // silently skipped -- proving it was actually requested this time.
    const result = await crawlWebsite("http://public.example.com/", { respectRobotsTxt: false });
    const secret = result.pages.find((p) => p.url === "http://public.example.com/private/secret");
    expect(secret?.error).not.toMatch(/robots\.txt/i);
  });

  it("stops at maxPages and records a limitation", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/", { maxPages: 1 });
    expect(result.pages.length).toBeLessThanOrEqual(1);
    expect(result.limitations.some((l) => l.includes("maxPages limit"))).toBe(true);
  });

  it("always records the JS-rendering limitation", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/", { maxPages: 1 });
    expect(result.limitations.some((l) => l.includes("client-side JavaScript"))).toBe(true);
  });
});
