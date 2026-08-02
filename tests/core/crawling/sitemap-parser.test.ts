import { describe, expect, it } from "vitest";
import { parseSitemapXml } from "../../../src/core/crawling/sitemap-parser.js";

describe("parseSitemapXml", () => {
  it("parses a plain urlset sitemap", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about/</loc></url>
</urlset>`;
    const parsed = parseSitemapXml(xml);
    expect(parsed.isIndex).toBe(false);
    expect(parsed.urls).toEqual(["https://example.com/", "https://example.com/about/"]);
    expect(parsed.childSitemaps).toEqual([]);
  });

  it("parses a sitemap index", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;
    const parsed = parseSitemapXml(xml);
    expect(parsed.isIndex).toBe(true);
    expect(parsed.childSitemaps).toEqual(["https://example.com/sitemap-1.xml", "https://example.com/sitemap-2.xml"]);
    expect(parsed.urls).toEqual([]);
  });

  it("decodes &amp; in loc values", () => {
    const xml = `<urlset><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>`;
    expect(parseSitemapXml(xml).urls).toEqual(["https://example.com/?a=1&b=2"]);
  });

  it("returns an empty result for malformed/empty input rather than throwing", () => {
    expect(parseSitemapXml("")).toEqual({ isIndex: false, urls: [], childSitemaps: [] });
    expect(() => parseSitemapXml("not xml at all")).not.toThrow();
  });
});
