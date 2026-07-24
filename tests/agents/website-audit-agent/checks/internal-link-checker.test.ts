import { describe, expect, it } from "vitest";
import { InternalLinkChecker } from "../../../../src/agents/website-audit-agent/checks/internal-link-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

describe("InternalLinkChecker", () => {
  const checker = new InternalLinkChecker();

  it("reports a warning when there are no internal links", () => {
    const facts = extractHtmlFacts('<a href="https://external.com/x">External</a>');
    const findings = checker.check(facts, { url: "https://example.com/page", robotsTxtContent: null });
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("No internal links"))).toBe(true);
  });

  it("counts relative links as internal and flags empty/placeholder hrefs", () => {
    const facts = extractHtmlFacts('<a href="/about">About</a><a href="#">Placeholder</a><a href="">Empty</a>');
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings.some((f) => f.message.includes("2 link(s) have an empty or placeholder href"))).toBe(true);
    expect(findings.some((f) => f.message.includes("Found 1 internal link(s) and 0 external"))).toBe(true);
  });

  it("classifies same-host absolute links as internal and other hosts as external", () => {
    const facts = extractHtmlFacts(
      '<a href="https://example.com/other">Same host</a><a href="https://elsewhere.com/x">Other host</a>',
    );
    const findings = checker.check(facts, { url: "https://example.com/page", robotsTxtContent: null });
    expect(findings.some((f) => f.message.includes("Found 1 internal link(s) and 1 external"))).toBe(true);
  });

  it("ignores mailto, tel, and javascript links entirely", () => {
    const facts = extractHtmlFacts(
      '<a href="mailto:test@example.com">Email</a><a href="tel:12345">Call</a><a href="javascript:void(0)">JS</a>',
    );
    const findings = checker.check(facts, { url: null, robotsTxtContent: null });
    expect(findings.some((f) => f.message.includes("No internal links"))).toBe(true);
  });
});
