import { describe, expect, it } from "vitest";
import { HeaderSecurityChecker } from "../../../../src/agents/website-audit-agent/checks/header-security-checker.js";
import type { WebsiteCrawlResult } from "../../../../src/core/crawling/website-crawler.js";

function crawl(pages: WebsiteCrawlResult["pages"]): WebsiteCrawlResult {
  return { startUrl: "https://example.com/", pages, robotsTxt: null, robotsTxtContent: null, sitemapUrls: [], limitations: [] };
}

const GOOD_HEADERS = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=63072000",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cache-control": "public, max-age=3600",
};

function page(url: string, headers: Record<string, string> | null, overrides: Partial<WebsiteCrawlResult["pages"][number]> = {}) {
  return {
    url,
    finalUrl: url,
    status: 200,
    html: "<p>hi</p>",
    redirectChain: [url],
    discoveredFrom: null,
    error: null,
    headers,
    ...overrides,
  };
}

describe("HeaderSecurityChecker", () => {
  const checker = new HeaderSecurityChecker();

  it("returns no findings when no page was actually fetched", () => {
    const result = crawl([page("https://example.com/", null, { html: null, status: null })]);
    expect(checker.check(result)).toEqual([]);
  });

  it("reports info when every checked header is present and correctly configured", () => {
    const result = crawl([page("https://example.com/", GOOD_HEADERS)]);
    const findings = checker.check(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toContain("expected security-related HTTP response headers");
  });

  it("flags a missing Content-Security-Policy header", () => {
    const { "content-security-policy": _omit, ...rest } = GOOD_HEADERS;
    const result = crawl([page("https://example.com/", rest)]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("Content-Security-Policy"))).toBe(true);
  });

  it("does not flag X-Frame-Options when a CSP frame-ancestors directive covers it", () => {
    const headers = { ...GOOD_HEADERS, "content-security-policy": "frame-ancestors 'self'" };
    delete (headers as Record<string, string>)["x-frame-options"];
    const result = crawl([page("https://example.com/", headers)]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.message.includes("X-Frame-Options"))).toBe(false);
  });

  it("only checks HSTS on HTTPS pages", () => {
    const { "strict-transport-security": _omit, ...rest } = GOOD_HEADERS;
    const result = crawl([page("http://example.com/", rest)]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.message.includes("Strict-Transport-Security"))).toBe(false);
  });

  it("flags missing HSTS on an HTTPS page", () => {
    const { "strict-transport-security": _omit, ...rest } = GOOD_HEADERS;
    const result = crawl([page("https://example.com/", rest)]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("Strict-Transport-Security"))).toBe(true);
  });

  it("treats a non-nosniff X-Content-Type-Options value as missing", () => {
    const result = crawl([page("https://example.com/", { ...GOOD_HEADERS, "x-content-type-options": "garbage" })]);
    const findings = checker.check(result);
    expect(findings.some((f) => f.message.includes("X-Content-Type-Options"))).toBe(true);
  });

  it("aggregates the same missing header across multiple pages into one finding", () => {
    const { "cache-control": _omit, ...rest } = GOOD_HEADERS;
    const result = crawl([page("https://example.com/", rest), page("https://example.com/about/", rest)]);
    const findings = checker.check(result);
    const cacheFinding = findings.find((f) => f.message.includes("Cache-Control"));
    expect(cacheFinding?.message).toContain("2 of 2 checked page(s)");
  });

  it("ignores pages that were never fetched when computing the applicable-page count", () => {
    const result = crawl([page("https://example.com/", GOOD_HEADERS), page("https://example.com/missing", null, { html: null, status: 404 })]);
    const findings = checker.check(result);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });
});
