import { describe, expect, it } from "vitest";
import { RobotsTxtChecker } from "../../../../src/agents/website-audit-agent/checks/robots-txt-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const EMPTY_FACTS = extractHtmlFacts("");

describe("RobotsTxtChecker", () => {
  const checker = new RobotsTxtChecker();

  it("reports info when no robots.txt content is supplied", () => {
    const findings = checker.check(EMPTY_FACTS, { url: null, robotsTxtContent: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports info when robots.txt has no Sitemap reference", () => {
    const findings = checker.check(EMPTY_FACTS, {
      url: null,
      robotsTxtContent: "User-agent: *\nDisallow: /admin",
    });
    expect(findings.some((f) => f.message.includes("Sitemap"))).toBe(true);
  });

  it("does not flag a missing sitemap when one is present", () => {
    const findings = checker.check(EMPTY_FACTS, {
      url: null,
      robotsTxtContent: "User-agent: *\nSitemap: https://example.com/sitemap.xml",
    });
    expect(findings.some((f) => f.message.includes("No Sitemap"))).toBe(false);
  });

  it("reports critical when the audited URL's path is disallowed", () => {
    const findings = checker.check(EMPTY_FACTS, {
      url: "https://example.com/admin/settings",
      robotsTxtContent: "User-agent: *\nDisallow: /admin",
    });
    expect(findings.some((f) => f.severity === "critical" && f.message.includes("/admin"))).toBe(true);
  });

  it("does not flag a URL whose path is not disallowed", () => {
    const findings = checker.check(EMPTY_FACTS, {
      url: "https://example.com/blog/post",
      robotsTxtContent: "User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml",
    });
    expect(findings.some((f) => f.severity === "critical")).toBe(false);
  });
});
