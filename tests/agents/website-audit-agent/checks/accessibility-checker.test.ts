import { describe, expect, it } from "vitest";
import { AccessibilityChecker } from "../../../../src/agents/website-audit-agent/checks/accessibility-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("AccessibilityChecker", () => {
  const checker = new AccessibilityChecker();

  it("flags a link with no visible text and no aria-label", () => {
    const html = '<main><a href="/page"><img src="/x.jpg" alt=""></a></main>';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("no visible text"))).toBe(true);
  });

  it("does not flag a link with an aria-label even if visible text is empty", () => {
    const html = '<main><a href="/page" aria-label="Go to page"></a></main>';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("no visible text"))).toBe(false);
  });

  it("flags generic link text like 'click here'", () => {
    const html = '<main><a href="/page">Click here</a></main>';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "info" && f.message.includes("generic text"))).toBe(true);
  });

  it("flags a missing <main> landmark", () => {
    const findings = checker.check(extractHtmlFacts("<body><h1>Hi</h1></body>"), CONTEXT);
    expect(findings.some((f) => f.message.includes("<main>"))).toBe(true);
  });

  it("does not flag a main landmark expressed via role=\"main\"", () => {
    const findings = checker.check(extractHtmlFacts('<div role="main"><h1>Hi</h1></div>'), CONTEXT);
    expect(findings.some((f) => f.message.includes("<main>"))).toBe(false);
  });

  it("ignores placeholder and non-navigational hrefs when checking accessible names", () => {
    const html = '<main><a href="#"></a><a href="mailto:x@example.com"></a></main>';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("no visible text"))).toBe(false);
  });
});
