import { describe, expect, it } from "vitest";
import { ImageAltChecker } from "../../../../src/agents/website-audit-agent/checks/image-alt-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("ImageAltChecker", () => {
  const checker = new ImageAltChecker();

  it("reports info when there are no images", () => {
    const findings = checker.check(extractHtmlFacts("<html></html>"), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("reports a warning when at least one image is missing alt entirely", () => {
    const facts = extractHtmlFacts('<img src="/a.jpg" alt="A photo"><img src="/b.jpg">');
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("1 of 2"))).toBe(true);
  });

  it("does not flag an image with an empty (decorative) alt attribute", () => {
    const facts = extractHtmlFacts('<img src="/a.jpg" alt="">');
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "warning")).toBe(false);
  });

  it("reports info when every image has an alt attribute", () => {
    const facts = extractHtmlFacts('<img src="/a.jpg" alt="A"><img src="/b.jpg" alt="">');
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("All 2 image(s)"))).toBe(true);
  });
});
