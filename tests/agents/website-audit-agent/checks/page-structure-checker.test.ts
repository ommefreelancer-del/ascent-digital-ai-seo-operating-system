import { describe, expect, it } from "vitest";
import { PageStructureChecker } from "../../../../src/agents/website-audit-agent/checks/page-structure-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("PageStructureChecker", () => {
  const checker = new PageStructureChecker();

  it("flags a missing doctype, lang attribute, and viewport meta", () => {
    const facts = extractHtmlFacts("<html><body></body></html>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("DOCTYPE"))).toBe(true);
    expect(findings.some((f) => f.message.includes("lang attribute"))).toBe(true);
    expect(findings.some((f) => f.message.includes("viewport"))).toBe(true);
  });

  it("does not flag any of those when all are present", () => {
    const facts = extractHtmlFacts(
      '<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width"></head></html>',
    );
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("DOCTYPE"))).toBe(false);
    expect(findings.some((f) => f.message.includes("lang attribute"))).toBe(false);
    expect(findings.some((f) => f.message.includes("viewport"))).toBe(false);
  });

  it("reports info when there is no structured data", () => {
    const facts = extractHtmlFacts("<html></html>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("No structured data"))).toBe(true);
  });

  it("flags invalid JSON inside a structured data block", () => {
    const facts = extractHtmlFacts('<script type="application/ld+json">{ not valid json </script>');
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("invalid JSON"))).toBe(true);
  });

  it("does not flag valid JSON structured data", () => {
    const facts = extractHtmlFacts('<script type="application/ld+json">{"@type": "Article"}</script>');
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("invalid JSON"))).toBe(false);
  });
});
