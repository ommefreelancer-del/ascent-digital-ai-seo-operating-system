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

  // REGRESSION (QA-002): every crawled page must carry a verified outcome,
  // content-type, and real fetch duration -- not just url/status/error --
  // so a failure can be reported with real diagnostics instead of a generic
  // message.
  it("records outcome, content-type, and duration for a successfully-crawled page", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/", { maxPages: 1 });
    const start = result.pages.find((p) => p.url === "http://public.example.com/");
    expect(start?.outcome).toBe("success");
    expect(start?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records the real HTTP error category and status for a page that 404s, including the response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (url.toString() === "http://public.example.com/robots.txt") return new Response("not found", { status: 404 });
        if (url.toString() === "http://public.example.com/sitemap.xml") return new Response("not found", { status: 404 });
        return new Response("<html><body>404</body></html>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      }),
    );
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/");
    const start = result.pages.find((p) => p.url === "http://public.example.com/");
    expect(start?.status).toBe(404);
    expect(start?.outcome).toBe("http_error");
    expect(start?.contentType).toBe("text/html; charset=utf-8");
    expect(start?.error).toMatch(/HTTP 404/);
  });

  it("records outcome 'invalid_html' for a 200 response whose body is not real HTML, without treating it as successfully crawled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (url.toString() === "http://public.example.com/robots.txt") return new Response("not found", { status: 404 });
        if (url.toString() === "http://public.example.com/sitemap.xml") return new Response("not found", { status: 404 });
        return new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/");
    const start = result.pages.find((p) => p.url === "http://public.example.com/");
    expect(start?.outcome).toBe("invalid_html");
    expect(start?.contentType).toBe("application/json");
    expect(start?.error).toMatch(/Invalid HTML/i);
  });

  it("records outcome 'robots_blocked' (not a generic error) for a page disallowed by robots.txt", async () => {
    installFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("http://public.example.com/");
    const blocked = result.pages.find((p) => p.url === "http://public.example.com/private/secret");
    expect(blocked?.outcome).toBe("robots_blocked");
  });
});

// REGRESSION (2026-09-10): the exact real production incident --
// https://ommefreelancer-del.github.io/portfolio-website/ (a GitHub-Pages
// "project site", hosted under a repo-name path, not at the account root).
// The site's own real, published sitemap.xml at
// https://user.github.io/repo/sitemap.xml correctly lists 6 blog article
// pages that are otherwise genuine ORPHANS: linked from nowhere else on the
// site (confirmed against the real live site -- the blog index page's own
// nav/footer never links to a single article), so sitemap discovery is the
// ONLY way the crawler can ever find them. The bug: robots.txt and the
// sitemap.xml fallback were resolved against the bare account-level origin
// (https://user.github.io/robots.txt) instead of the project's own base
// (https://user.github.io/repo/robots.txt) -- landing on completely
// different, unrelated, real GitHub-account-root infrastructure that has no
// Sitemap: line at all, silently discarding the site's real sitemap and its
// 6 real blog articles with it. This fixture reproduces exactly that split:
// the account-root robots.txt/sitemap.xml genuinely exist and genuinely
// differ from the project's own.
const PROJECT_SITE_PAGES: Record<string, { status: number; body: string }> = {
  // The WRONG, account-root robots.txt a buggy bare-origin fetch would find
  // -- real, reachable, genuinely different content, no Sitemap: line.
  "https://user.github.io/robots.txt": { status: 200, body: "User-agent: *\nAllow: /" },
  // The REAL, correct, project-site robots.txt -- has the real Sitemap: line.
  "https://user.github.io/repo/robots.txt": {
    status: 200,
    body: "User-agent: *\nAllow: /\n\nSitemap: https://user.github.io/repo/sitemap.xml",
  },
  // The REAL, correct, project-site sitemap.xml -- lists the homepage, the
  // blog index, and the 6 orphan blog articles nothing else links to.
  "https://user.github.io/repo/sitemap.xml": {
    status: 200,
    body:
      `<urlset><url><loc>https://user.github.io/repo/</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-1.html</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-2.html</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-3.html</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-4.html</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-5.html</loc></url>` +
      `<url><loc>https://user.github.io/repo/blog/post-6.html</loc></url></urlset>`,
  },
  "https://user.github.io/repo/": {
    status: 200,
    // Deliberately links ONLY to the blog index, never to a single article
    // -- mirrors the real site's own actual, confirmed HTML exactly.
    body: `<html><body><a href="blog/">Blog</a></body></html>`,
  },
  "https://user.github.io/repo/blog/": {
    status: 200,
    // The real site's own confirmed behavior: the blog index's nav/footer
    // links back to other site sections and to itself, but never to any of
    // its own article pages.
    body: `<html><body><a href="../">Home</a></body></html>`,
  },
  "https://user.github.io/repo/blog/post-1.html": { status: 200, body: "<html><body>Post 1</body></html>" },
  "https://user.github.io/repo/blog/post-2.html": { status: 200, body: "<html><body>Post 2</body></html>" },
  "https://user.github.io/repo/blog/post-3.html": { status: 200, body: "<html><body>Post 3</body></html>" },
  "https://user.github.io/repo/blog/post-4.html": { status: 200, body: "<html><body>Post 4</body></html>" },
  "https://user.github.io/repo/blog/post-5.html": { status: 200, body: "<html><body>Post 5</body></html>" },
  "https://user.github.io/repo/blog/post-6.html": { status: 200, body: "<html><body>Post 6</body></html>" },
};

function installProjectSiteFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const page = PROJECT_SITE_PAGES[url.toString()];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page.body, { status: page.status });
    }),
  );
}

describe("crawlWebsite -- GitHub-Pages-style project site (non-root path)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("fetches robots.txt relative to the site's own start URL, not the bare account-level origin", async () => {
    installProjectSiteFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://user.github.io/repo/");

    // The real, project-site robots.txt was fetched -- proven by its
    // Sitemap: line having actually been parsed into robotsTxt.sitemaps.
    expect(result.robotsTxt?.sitemaps).toContain("https://user.github.io/repo/sitemap.xml");
  });

  it("discovers the real sitemap.xml and every URL it lists, not 0", async () => {
    installProjectSiteFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://user.github.io/repo/");

    expect(result.sitemapUrls.length).toBe(8);
    expect(result.sitemapUrls).toContain("https://user.github.io/repo/blog/post-1.html");
    expect(result.sitemapUrls).toContain("https://user.github.io/repo/blog/post-6.html");
  });

  it("actually crawls every sitemap-only article page even though none of them is linked from anywhere on the site", async () => {
    installProjectSiteFetchMock();
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    const result = await crawlWebsite("https://user.github.io/repo/");

    const successfulUrls = result.pages.filter((p) => p.outcome === "success").map((p) => p.url);
    for (let i = 1; i <= 6; i++) {
      expect(successfulUrls).toContain(`https://user.github.io/repo/blog/post-${i}.html`);
    }
  });

  it("never fetches the wrong, account-root sitemap.xml as a fallback once the real one is found via robots.txt", async () => {
    const fetchSpy = vi.fn(async (url: string | URL) => {
      const page = PROJECT_SITE_PAGES[url.toString()];
      if (!page) return new Response("not found", { status: 404 });
      return new Response(page.body, { status: page.status });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { crawlWebsite } = await import("../../../src/core/crawling/website-crawler.js");
    await crawlWebsite("https://user.github.io/repo/");

    const requestedUrls = fetchSpy.mock.calls.map((call) => call[0].toString());
    expect(requestedUrls).not.toContain("https://user.github.io/sitemap.xml");
  });
});
