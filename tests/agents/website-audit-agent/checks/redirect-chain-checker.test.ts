import { describe, expect, it } from "vitest";
import { RedirectChainChecker } from "../../../../src/agents/website-audit-agent/checks/redirect-chain-checker.js";
import type { WebsiteCrawlResult } from "../../../../src/core/crawling/website-crawler.js";

function crawl(pages: WebsiteCrawlResult["pages"]): WebsiteCrawlResult {
  return { startUrl: "https://example.com/", pages, robotsTxt: null, robotsTxtContent: null, sitemapUrls: [], limitations: [] };
}

describe("RedirectChainChecker", () => {
  const checker = new RedirectChainChecker();

  it("reports info when no page had a redirect chain", () => {
    const result = crawl([
      {
        url: "https://example.com/",
        finalUrl: "https://example.com/",
        status: 200,
        html: "<p>Hi</p>",
        redirectChain: ["https://example.com/"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports info-level for a single redirect hop", () => {
    const result = crawl([
      {
        url: "https://example.com/old",
        finalUrl: "https://example.com/new",
        status: 200,
        html: "<p>Hi</p>",
        redirectChain: ["https://example.com/old", "https://example.com/new"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports warning for a chain of 2+ redirect hops", () => {
    const result = crawl([
      {
        url: "https://example.com/a",
        finalUrl: "https://example.com/c",
        status: 200,
        html: "<p>Hi</p>",
        redirectChain: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
        discoveredFrom: null,
        error: null,
        headers: null,
      },
    ]);
    const findings = checker.check(result);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("2 redirect hop(s)");
  });
});
