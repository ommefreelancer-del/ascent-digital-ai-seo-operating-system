import { describe, expect, it } from "vitest";
import { TwitterCardChecker } from "../../../../src/agents/website-audit-agent/checks/twitter-card-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("TwitterCardChecker", () => {
  const checker = new TwitterCardChecker();

  it("reports info (not a hard failure) when no twitter:card tag is present", () => {
    const findings = checker.check(extractHtmlFacts("<html></html>"), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toContain("No twitter:card");
  });

  it("reports only the presence finding when twitter:card is present and a page <title> exists", () => {
    const html = '<title>My Page</title><meta name="twitter:card" content="summary">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("twitter:card meta tag is present");
  });

  it("flags missing twitter:title when there is also no page <title>", () => {
    const html = '<meta name="twitter:card" content="summary">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("No twitter:title"))).toBe(true);
  });
});
