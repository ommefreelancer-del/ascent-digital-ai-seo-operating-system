import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobotsTxt } from "../../../src/core/crawling/robots-txt-parser.js";

describe("parseRobotsTxt", () => {
  it("parses a single group with Disallow, Allow, and Sitemap directives", () => {
    const parsed = parseRobotsTxt(
      ["User-agent: *", "Disallow: /admin", "Allow: /admin/public", "Sitemap: https://example.com/sitemap.xml"].join("\n"),
    );
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.userAgents).toEqual(["*"]);
    expect(parsed.groups[0]?.disallow).toEqual(["/admin"]);
    expect(parsed.groups[0]?.allow).toEqual(["/admin/public"]);
    expect(parsed.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("parses multiple groups for different user agents", () => {
    const parsed = parseRobotsTxt(
      ["User-agent: Googlebot", "Disallow: /private", "", "User-agent: *", "Disallow: /admin"].join("\n"),
    );
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]?.userAgents).toEqual(["Googlebot"]);
    expect(parsed.groups[1]?.userAgents).toEqual(["*"]);
  });

  it("groups consecutive User-agent lines that share the same rules", () => {
    const parsed = parseRobotsTxt(["User-agent: Googlebot", "User-agent: Bingbot", "Disallow: /admin"].join("\n"));
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.userAgents).toEqual(["Googlebot", "Bingbot"]);
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseRobotsTxt(["# comment", "", "User-agent: *", "Disallow: /admin # trailing comment"].join("\n"));
    expect(parsed.groups[0]?.disallow).toEqual(["/admin"]);
  });

  it("returns empty groups and sitemaps for empty content", () => {
    const parsed = parseRobotsTxt("");
    expect(parsed.groups).toEqual([]);
    expect(parsed.sitemaps).toEqual([]);
  });
});

describe("isPathAllowed", () => {
  it("allows everything when there is no robots.txt content", () => {
    const parsed = parseRobotsTxt("");
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/anything")).toBe(true);
  });

  it("disallows a path matched by a Disallow rule", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /admin");
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/admin/settings")).toBe(false);
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/blog/post")).toBe(true);
  });

  it("prefers the longer (more specific) matching rule", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /admin\nAllow: /admin/public");
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/admin/public/page")).toBe(true);
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/admin/private")).toBe(false);
  });

  it("supports wildcard and end-anchor rules", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /*.pdf$");
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/file.pdf")).toBe(false);
    expect(isPathAllowed(parsed, "ADASOS-Crawler/1.0", "/file.pdf.html")).toBe(true);
  });

  it("falls back to the '*' group when the named user agent has no group", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /admin");
    expect(isPathAllowed(parsed, "SomeOtherBot/1.0", "/admin")).toBe(false);
  });
});
