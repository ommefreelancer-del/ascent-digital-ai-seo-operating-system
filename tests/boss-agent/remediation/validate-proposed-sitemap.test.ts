import { describe, expect, it } from "vitest";
import { buildProposedSitemapContent } from "../../../src/boss-agent/remediation/sitemap-remediation-planner.js";
import { validateProposedSitemap } from "../../../src/boss-agent/remediation/validate-proposed-sitemap.js";

describe("validateProposedSitemap", () => {
  it("passes a real, valid, complete sitemap built from real crawled URLs", () => {
    const crawledUrls = ["https://real-site.example.com/", "https://real-site.example.com/about/", "https://real-site.example.com/blog/post-1.html"];
    const xml = buildProposedSitemapContent(crawledUrls);

    const result = validateProposedSitemap(xml, "https://real-site.example.com/", crawledUrls);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("detects an empty sitemap", () => {
    const xml = buildProposedSitemapContent([]);
    const result = validateProposedSitemap(xml, "https://real-site.example.com/", []);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("0 URLs"))).toBe(true);
  });

  it("detects an incomplete sitemap -- a real crawled page missing from the proposed XML", () => {
    const crawledUrls = ["https://real-site.example.com/", "https://real-site.example.com/blog/post-1.html"];
    // Proposal built from only ONE of the two real crawled URLs -- the exact
    // real incident class (a genuinely crawled page silently omitted).
    const xml = buildProposedSitemapContent(["https://real-site.example.com/"]);

    const result = validateProposedSitemap(xml, "https://real-site.example.com/", crawledUrls);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("blog/post-1.html"))).toBe(true);
  });

  it("detects a duplicate URL in the proposed sitemap", () => {
    const xml = buildProposedSitemapContent(["https://real-site.example.com/", "https://real-site.example.com/"]);
    const result = validateProposedSitemap(xml, "https://real-site.example.com/", ["https://real-site.example.com/"]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("duplicate"))).toBe(true);
  });

  it("detects a URL that does not belong to the target site", () => {
    const xml = buildProposedSitemapContent(["https://real-site.example.com/", "https://not-this-site.example/page"]);
    const result = validateProposedSitemap(xml, "https://real-site.example.com/", ["https://real-site.example.com/"]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("does not belong to the target site"))).toBe(true);
  });

  it("detects a placeholder/example.com URL", () => {
    const xml = buildProposedSitemapContent(["https://example.com/about/"]);
    const result = validateProposedSitemap(xml, "https://example.com/", ["https://example.com/about/"]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("placeholder"))).toBe(true);
  });

  it("detects a localhost URL", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://localhost/page</loc></url></urlset>`;
    const result = validateProposedSitemap(xml, "http://localhost/", ["http://localhost/page"]);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("placeholder"))).toBe(true);
  });

  it("rejects a sitemap index where a plain urlset was expected", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    const result = validateProposedSitemap(xml, "https://example.com/", []);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("sitemap index"))).toBe(true);
  });

  it("passes the real 6-blog-article scenario -- 6/6 published blog articles present, no duplicates, no invalid URLs", () => {
    const crawledUrls = [
      "https://ommefreelancer-del.github.io/portfolio-website/",
      "https://ommefreelancer-del.github.io/portfolio-website/about/",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-an-seo-audit.html",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-guest-posting.html",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-keyword-research.html",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-on-page-seo.html",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-off-page-seo.html",
      "https://ommefreelancer-del.github.io/portfolio-website/blog/what-is-technical-seo.html",
    ];
    const xml = buildProposedSitemapContent(crawledUrls);
    const result = validateProposedSitemap(xml, "https://ommefreelancer-del.github.io/portfolio-website/", crawledUrls);

    expect(result.valid).toBe(true);
    const articleCount = crawledUrls.filter((u) => /\/blog\/what-is-/.test(u)).length;
    expect(articleCount).toBe(6);
  });
});
