import { describe, expect, it } from "vitest";
import { CanonicalChecker } from "../../../../src/agents/website-audit-agent/checks/canonical-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

describe("CanonicalChecker", () => {
  const checker = new CanonicalChecker();

  it("reports a warning when no canonical tag is present", () => {
    const facts = extractHtmlFacts("<html></html>");
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings.some((f) => f.severity === "warning")).toBe(true);
  });

  it("produces no finding when the canonical matches the audited url", () => {
    const facts = extractHtmlFacts('<link rel="canonical" href="https://example.com/page">');
    const findings = checker.check(facts, { url: "https://example.com/page", robotsTxtContent: null });
    expect(findings).toEqual([]);
  });

  it("reports info when the canonical points elsewhere", () => {
    const facts = extractHtmlFacts('<link rel="canonical" href="https://example.com/other-page">');
    const findings = checker.check(facts, { url: "https://example.com/page", robotsTxtContent: null });
    expect(findings.some((f) => f.severity === "info" && f.message.includes("differs"))).toBe(true);
  });

  it("does not compare against a url when none is supplied", () => {
    const facts = extractHtmlFacts('<link rel="canonical" href="https://example.com/page">');
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings).toEqual([]);
  });
});
