import { describe, expect, it } from "vitest";
import { buildCrawlFailureDiagnostic, type RawCrawledPage } from "../../../src/server/backend/website-audit";

// REGRESSION (QA-002): the Website Audit Agent previously reported a single
// generic message ("fetch failure, robots.txt block, or non-HTML response")
// for every crawl failure, regardless of what was actually diagnosed. These
// tests lock in that the real, verified diagnostics captured during the
// crawl (HTTP status, category, content-type, redirect chain, duration) are
// what actually get reported -- never a generic fallback when real data was
// captured.

const emptyCrawl = { robotsTxtContent: null, sitemapUrls: [], limitations: [] };

describe("buildCrawlFailureDiagnostic", () => {
  it("reports the exact verified HTTP status instead of a generic message (reproduces the reported https://ommefreelancer-del.github.io 404)", () => {
    const page: RawCrawledPage = {
      url: "https://ommefreelancer-del.github.io/",
      finalUrl: "https://ommefreelancer-del.github.io/",
      status: 404,
      error: "Fetching https://ommefreelancer-del.github.io/ failed with HTTP 404.",
      headers: { "content-type": "text/html; charset=utf-8" },
      contentType: "text/html; charset=utf-8",
      outcome: "http_error",
      durationMs: 187,
      redirectChain: ["https://ommefreelancer-del.github.io/"],
    };
    const report = buildCrawlFailureDiagnostic("https://ommefreelancer-del.github.io", emptyCrawl, page, 200);

    expect(report).toContain("HTTP status: 404");
    expect(report).toContain("Content-Type: text/html; charset=utf-8");
    expect(report).toContain("Verified outcome: http_error");
    expect(report).toContain("Fetch duration: 187ms");
    expect(report).toContain("Total crawl duration: 200ms");
    // Never the old generic fallback:
    expect(report).not.toContain("possible causes");
    expect(report).not.toContain("fetch failure, robots.txt block, or non-HTML response");
  });

  it("reports a DNS failure verbatim, not as a generic fetch failure", () => {
    const page: RawCrawledPage = {
      url: "http://does-not-exist.example/",
      finalUrl: null,
      status: null,
      error: "DNS lookup failed for does-not-exist.example.",
      headers: null,
      contentType: null,
      outcome: "dns_failure",
      durationMs: null,
      redirectChain: [],
    };
    const report = buildCrawlFailureDiagnostic("http://does-not-exist.example/", emptyCrawl, page, 50);
    expect(report).toContain("Verified outcome: dns_failure");
    expect(report).toContain("Exact reason: DNS lookup failed for does-not-exist.example.");
  });

  it("reports an SSL/TLS failure verbatim", () => {
    const page: RawCrawledPage = {
      url: "https://expired-cert.example/",
      finalUrl: null,
      status: null,
      error: "SSL/TLS certificate error for https://expired-cert.example/: CERT_HAS_EXPIRED.",
      headers: null,
      contentType: null,
      outcome: "ssl_failure",
      durationMs: null,
      redirectChain: [],
    };
    const report = buildCrawlFailureDiagnostic("https://expired-cert.example/", emptyCrawl, page, 30);
    expect(report).toContain("Verified outcome: ssl_failure");
    expect(report).toMatch(/CERT_HAS_EXPIRED/);
  });

  it("reports a timeout with the real reason", () => {
    const page: RawCrawledPage = {
      url: "http://slow.example/",
      finalUrl: null,
      status: null,
      error: "Request to http://slow.example/ timed out after 10 seconds.",
      headers: null,
      contentType: null,
      outcome: "timeout",
      durationMs: null,
      redirectChain: [],
    };
    const report = buildCrawlFailureDiagnostic("http://slow.example/", emptyCrawl, page, 10000);
    expect(report).toContain("Verified outcome: timeout");
    expect(report).toContain("timed out after 10 seconds");
  });

  it("reports robots.txt and sitemap.xml status from real crawl evidence", () => {
    const page: RawCrawledPage = {
      url: "http://public.example.com/",
      finalUrl: "http://public.example.com/",
      status: 200,
      error: null,
      headers: {},
      contentType: "text/html",
      outcome: "success",
      durationMs: 20,
      redirectChain: ["http://public.example.com/"],
    };
    const report = buildCrawlFailureDiagnostic(
      "http://public.example.com/",
      { robotsTxtContent: "User-agent: *", sitemapUrls: ["http://public.example.com/a", "http://public.example.com/b"], limitations: [] },
      page,
      40,
    );
    expect(report).toContain("robots.txt: found and checked");
    expect(report).toContain("sitemap.xml: 2 URL(s) discovered");
  });

  it("handles the case where no page was ever fetched, without fabricating a status or reason", () => {
    const report = buildCrawlFailureDiagnostic("http://public.example.com/", emptyCrawl, null, 5);
    expect(report).toContain("No page was ever fetched");
    expect(report).not.toMatch(/HTTP status:/);
  });

  it("includes real crawl limitations verbatim", () => {
    const page: RawCrawledPage = {
      url: "http://public.example.com/",
      finalUrl: null,
      status: null,
      error: "Blocked by robots.txt Disallow rule -- not fetched.",
      headers: null,
      contentType: null,
      outcome: "robots_blocked",
      durationMs: null,
      redirectChain: [],
    };
    const report = buildCrawlFailureDiagnostic(
      "http://public.example.com/",
      { robotsTxtContent: "User-agent: *\nDisallow: /", sitemapUrls: [], limitations: ["robots.txt disallows the entire site for this user agent."] },
      page,
      15,
    );
    expect(report).toContain("Verified outcome: robots_blocked");
    expect(report).toContain("robots.txt disallows the entire site for this user agent.");
  });
});
