import { describe, expect, it } from "vitest";
import { SiteWideInternalLinkingChecker } from "../../../../src/agents/website-audit-agent/checks/site-wide-internal-linking-checker.js";
import type { WebsiteCrawlResult } from "../../../../src/core/crawling/website-crawler.js";

function crawl(pages: WebsiteCrawlResult["pages"]): WebsiteCrawlResult {
  return { startUrl: "https://example.com/", pages, robotsTxt: null, robotsTxtContent: null, sitemapUrls: [], limitations: [] };
}

const BASE_PAGE = { finalUrl: "https://example.com/", status: 200, html: "<p>Hi</p>", redirectChain: [], error: null, headers: null };

describe("SiteWideInternalLinkingChecker", () => {
  const checker = new SiteWideInternalLinkingChecker();

  it("reports info when every page was reached via an internal link", () => {
    const result = crawl([
      { ...BASE_PAGE, url: "https://example.com/", discoveredFrom: null },
      { ...BASE_PAGE, url: "https://example.com/about/", discoveredFrom: "https://example.com/" },
    ]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.severity === "warning")).toBe(false);
    expect(findings.some((f) => f.message.includes("No orphaned pages"))).toBe(true);
  });

  it("flags a page discovered only via sitemap.xml as orphaned", () => {
    const result = crawl([
      { ...BASE_PAGE, url: "https://example.com/", discoveredFrom: null },
      { ...BASE_PAGE, url: "https://example.com/orphan/", discoveredFrom: "sitemap.xml" },
    ]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("orphan"))).toBe(true);
  });

  it("does not count a page that failed to fetch as orphaned", () => {
    const result = crawl([
      { ...BASE_PAGE, url: "https://example.com/", discoveredFrom: null },
      { ...BASE_PAGE, url: "https://example.com/broken/", discoveredFrom: "sitemap.xml", html: null, status: 404, error: "HTTP 404" },
    ]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.message.includes("1 page(s)"))).toBe(false);
  });
});
