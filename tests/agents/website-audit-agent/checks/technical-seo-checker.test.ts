import { describe, expect, it } from "vitest";
import { TechnicalSeoChecker } from "../../../../src/agents/website-audit-agent/checks/technical-seo-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const EMPTY_FACTS = extractHtmlFacts("");

describe("TechnicalSeoChecker", () => {
  const checker = new TechnicalSeoChecker();

  it("reports info when no url is supplied", () => {
    const findings = checker.check(EMPTY_FACTS, { url: null, robotsTxtContent: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports critical for an http:// url", () => {
    const findings = checker.check(EMPTY_FACTS, { url: "http://example.com", robotsTxtContent: null });
    expect(findings[0]?.severity).toBe("critical");
  });

  it("reports info for an https:// url", () => {
    const findings = checker.check(EMPTY_FACTS, { url: "https://example.com", robotsTxtContent: null });
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toContain("HTTPS");
  });
});
