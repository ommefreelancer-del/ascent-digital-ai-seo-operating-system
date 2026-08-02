import { describe, expect, it } from "vitest";
import { OpenGraphChecker } from "../../../../src/agents/website-audit-agent/checks/open-graph-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("OpenGraphChecker", () => {
  const checker = new OpenGraphChecker();

  it("warns when there are no Open Graph tags at all", () => {
    const findings = checker.check(extractHtmlFacts("<html></html>"), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("No Open Graph");
  });

  it("warns and lists specific missing tags when some are present", () => {
    const facts = extractHtmlFacts('<meta property="og:title" content="Title">');
    const findings = checker.check(facts, CONTEXT);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("og:description");
    expect(findings[0]?.message).not.toContain("og:title,");
  });

  it("reports info when all core Open Graph tags are present", () => {
    const html = `
      <meta property="og:title" content="T">
      <meta property="og:description" content="D">
      <meta property="og:image" content="/img.jpg">
      <meta property="og:url" content="https://example.com/">
      <meta property="og:type" content="website">
    `;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });
});
