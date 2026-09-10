import { describe, expect, it } from "vitest";
import { buildProposedSitemapContent, planSitemapRemediation } from "../../../src/boss-agent/remediation/sitemap-remediation-planner.js";
import { parseSitemapXml } from "../../../src/core/crawling/sitemap-parser.js";

describe("planSitemapRemediation", () => {
  it("returns null when the real crawl already found real sitemap URLs -- a valid sitemap never triggers unnecessary remediation", () => {
    const task = planSitemapRemediation({ workspaceId: "ws-1", siteUrl: "https://example.com/", sitemapUrlsFound: 3, crawledUrls: ["https://example.com/", "https://example.com/about"] });
    expect(task).toBeNull();
  });

  it("returns null when there are no real crawled URLs to build a sitemap from -- never fabricates a placeholder URL", () => {
    const task = planSitemapRemediation({ workspaceId: "ws-1", siteUrl: "https://example.com/", sitemapUrlsFound: 0, crawledUrls: [] });
    expect(task).toBeNull();
  });

  it("plans a real remediation task from real crawled URLs when the sitemap is genuinely empty", () => {
    // real-site.example.com, not bare example.com -- see
    // validate-proposed-sitemap.ts's own PLACEHOLDER_HOSTS: bare
    // example.com/www.example.com are IANA-reserved documentation-only
    // domains (RFC 2606) and correctly rejected as placeholder URLs by the
    // pre-proposal validator this planner now runs, exactly matching this
    // task's own "never include an example.com URL" requirement -- a
    // subdomain of it is a fine, non-reserved stand-in for "some real site".
    const crawledUrls = ["https://real-site.example.com/", "https://real-site.example.com/about", "https://real-site.example.com/contact"];
    const task = planSitemapRemediation({ workspaceId: "ws-1", siteUrl: "https://real-site.example.com/", sitemapUrlsFound: 0, crawledUrls });

    expect(task).not.toBeNull();
    expect(task!.workspaceId).toBe("ws-1");
    expect(task!.affectedResource).toBe("https://real-site.example.com/sitemap.xml");
    expect(task!.requiredCapability).toBe("technical-remediation");
    expect(task!.requiredTool).toBe("repository-file-write-and-deploy");
    expect(task!.finalStatus).toBe("planned");
    expect(task!.findingId).toBe("sitemap-empty:https://real-site.example.com/");
    // REAL crawled URLs become sitemap entries -- every one of them, verbatim.
    for (const url of crawledUrls) {
      expect(task!.proposedAction).toContain(url);
    }
  });

  it("FABRICATED URLS CANNOT ENTER THE SITEMAP: the proposed content contains ONLY the real, supplied crawled URLs -- nothing invented, nothing from a different call", () => {
    const crawledUrls = ["https://real-site.example.com/", "https://real-site.example.com/only-this-real-page"];
    const task = planSitemapRemediation({ workspaceId: "ws-1", siteUrl: "https://real-site.example.com/", sitemapUrlsFound: 0, crawledUrls });

    const parsed = parseSitemapXml(task!.proposedAction);
    expect(parsed.urls).toEqual(crawledUrls);
    expect(parsed.urls).not.toContain("https://real-site.example.com/fabricated-page-never-crawled");
  });

  // PROJECT-SITE TARGETING FIX (2026-08-22): a real, live-reproduced defect
  // -- the sitemap URL used to be built as an ABSOLUTE path
  // (`new URL("/sitemap.xml", siteUrl)`), which silently discarded a GitHub
  // Pages project-site's own path prefix and landed on the account's origin
  // root instead -- a resource the connected project-site repository does
  // NOT control (confirmed live: BLOCKED, "this deployment only serves
  // paths under \"/portfolio-website/\""). A sitemap.xml has no
  // domain-root requirement (unlike robots.txt) -- resolving it RELATIVE to
  // the site's own real URL is what lets remediation target the site's own
  // actual, controlled deployment.
  it("PROJECT-SITE TARGETING FIX: a GitHub Pages project-site URL resolves the sitemap relative to its OWN real path, never the bare account origin root", () => {
    const task = planSitemapRemediation({
      workspaceId: "ws-1",
      siteUrl: "https://ommefreelancer-del.github.io/portfolio-website/",
      sitemapUrlsFound: 0,
      crawledUrls: ["https://ommefreelancer-del.github.io/portfolio-website/"],
    });

    expect(task!.affectedResource).toBe("https://ommefreelancer-del.github.io/portfolio-website/sitemap.xml");
    expect(task!.affectedResource).not.toBe("https://ommefreelancer-del.github.io/sitemap.xml");
  });

  it("a root-domain (user/org-site) URL still resolves the sitemap at the true origin root -- unchanged, normal behavior", () => {
    const task = planSitemapRemediation({
      workspaceId: "ws-1",
      siteUrl: "https://ommefreelancer-del.github.io/",
      sitemapUrlsFound: 0,
      crawledUrls: ["https://ommefreelancer-del.github.io/"],
    });

    expect(task!.affectedResource).toBe("https://ommefreelancer-del.github.io/sitemap.xml");
  });

  it("normalizes a siteUrl missing its trailing slash before resolving -- never accidentally replaces the last real path segment", () => {
    const task = planSitemapRemediation({
      workspaceId: "ws-1",
      siteUrl: "https://ommefreelancer-del.github.io/portfolio-website",
      sitemapUrlsFound: 0,
      crawledUrls: ["https://ommefreelancer-del.github.io/portfolio-website/"],
    });

    expect(task!.affectedResource).toBe("https://ommefreelancer-del.github.io/portfolio-website/sitemap.xml");
  });

  it("scopes each task to its own workspaceId (client isolation)", () => {
    const taskA = planSitemapRemediation({ workspaceId: "workspace-a", siteUrl: "https://a.example.com/", sitemapUrlsFound: 0, crawledUrls: ["https://a.example.com/"] });
    const taskB = planSitemapRemediation({ workspaceId: "workspace-b", siteUrl: "https://b.example.com/", sitemapUrlsFound: 0, crawledUrls: ["https://b.example.com/"] });

    expect(taskA!.workspaceId).toBe("workspace-a");
    expect(taskB!.workspaceId).toBe("workspace-b");
    expect(taskA!.taskId).not.toBe(taskB!.taskId);
  });
});

describe("buildProposedSitemapContent", () => {
  it("GENERATED SITEMAP XML IS VALID: produces well-formed XML that the project's own real sitemap parser round-trips back to the exact same URLs", () => {
    const crawledUrls = ["https://example.com/", "https://example.com/a", "https://example.com/b?x=1&y=2"];
    const content = buildProposedSitemapContent(crawledUrls);

    expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(content).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const parsed = parseSitemapXml(content);
    expect(parsed.isIndex).toBe(false);
    expect(parsed.urls).toEqual(crawledUrls);
  });

  it("produces a well-formed, empty (but still valid) urlset for an empty URL list -- never pads with an invented URL", () => {
    const content = buildProposedSitemapContent([]);
    const parsed = parseSitemapXml(content);
    expect(parsed.urls).toEqual([]);
    expect(content).toContain("<urlset");
  });

  it("XML-escapes special characters in a real URL so a query string can never break the document structure", () => {
    const content = buildProposedSitemapContent(["https://example.com/?a=1&b=2"]);
    expect(content).toContain("&amp;");
    expect(content).not.toMatch(/[^&]&(?!amp;)/);
  });
});
