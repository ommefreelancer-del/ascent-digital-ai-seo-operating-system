import { describe, expect, it } from "vitest";
import { CrawlabilityChecker } from "../../../../src/agents/website-audit-agent/checks/crawlability-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

describe("CrawlabilityChecker", () => {
  const checker = new CrawlabilityChecker();

  it("reports info when no meta robots tag is present", () => {
    const facts = extractHtmlFacts("<html><head></head><body></body></html>");
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports a critical finding for noindex", () => {
    const facts = extractHtmlFacts('<meta name="robots" content="noindex">');
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings.some((f) => f.severity === "critical" && f.message.includes("noindex"))).toBe(true);
  });

  it("reports a warning finding for nofollow", () => {
    const facts = extractHtmlFacts('<meta name="robots" content="nofollow">');
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("nofollow"))).toBe(true);
  });

  it("reports both when both directives are present", () => {
    const facts = extractHtmlFacts('<meta name="robots" content="noindex, nofollow">');
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings).toHaveLength(2);
  });
});
