import { describe, expect, it } from "vitest";
import { BrokenLinkChecker } from "../../../../src/agents/website-audit-agent/checks/broken-link-checker.js";
import type { WebsiteCrawlResult } from "../../../../src/core/crawling/website-crawler.js";

function crawl(pages: WebsiteCrawlResult["pages"]): WebsiteCrawlResult {
  return { startUrl: "https://example.com/", pages, robotsTxt: null, robotsTxtContent: null, sitemapUrls: [], limitations: [] };
}

describe("BrokenLinkChecker", () => {
  const checker = new BrokenLinkChecker();

  it("reports info when no broken internal links are found", () => {
    const result = crawl([
      {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        html: '<a href="/about/">About</a>',
        redirectChain: ["https://example.com/"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
      {
        url: "https://example.com/about/",
        finalUrl: "https://example.com/about/",
        status: 200,
        html: "<p>About us</p>",
        redirectChain: ["https://example.com/about/"],
        discoveredFrom: "https://example.com/",
        error: null,
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("flags a link to a page the crawler found returned a 404", () => {
    const result = crawl([
      {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        html: '<a href="/missing">Missing</a>',
        redirectChain: ["https://example.com/"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
      {
        url: "https://example.com/missing",
        finalUrl: null,
        status: 404,
        html: null,
        redirectChain: [],
        discoveredFrom: "https://example.com/",
        error: "Fetching https://example.com/missing failed with HTTP 404.",
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.message).toContain("https://example.com/missing");
  });

  it("does not flag a link to a page that was never crawled (unverified, not broken)", () => {
    const result = crawl([
      {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        html: '<a href="/never-visited">Somewhere</a>',
        redirectChain: ["https://example.com/"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings.every((f) => f.severity !== "critical")).toBe(true);
  });
});
