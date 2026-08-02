import { describe, expect, it } from "vitest";
import { MobileFriendlinessChecker } from "../../../../src/agents/website-audit-agent/checks/mobile-friendliness-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("MobileFriendlinessChecker", () => {
  const checker = new MobileFriendlinessChecker();

  it("reports critical when there is no viewport meta tag at all", () => {
    const findings = checker.check(extractHtmlFacts("<html></html>"), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
  });

  it("warns when the viewport content is missing width=device-width", () => {
    const html = '<meta name="viewport" content="initial-scale=1">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("width=device-width"))).toBe(true);
  });

  it("warns when pinch-zoom is disabled via user-scalable=no", () => {
    const html = '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("pinch-to-zoom"))).toBe(true);
  });

  it("warns when pinch-zoom is disabled via maximum-scale=1", () => {
    const html = '<meta name="viewport" content="width=device-width, maximum-scale=1">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("pinch-to-zoom"))).toBe(true);
  });

  it("reports info when the viewport tag is well-configured", () => {
    const html = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });
});
