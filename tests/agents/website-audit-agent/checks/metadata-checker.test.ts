import { describe, expect, it } from "vitest";
import { MetadataChecker } from "../../../../src/agents/website-audit-agent/checks/metadata-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("MetadataChecker", () => {
  const checker = new MetadataChecker();

  it("reports critical when there is no title", () => {
    const facts = extractHtmlFacts("<html><head></head></html>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "critical" && f.message.includes("title"))).toBe(true);
  });

  it("reports a warning for a too-short title", () => {
    const facts = extractHtmlFacts("<title>Hi</title>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.category === "metadata" && f.severity === "warning")).toBe(true);
  });

  it("reports a warning for a too-long title", () => {
    const facts = extractHtmlFacts(`<title>${"a".repeat(80)}</title>`);
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("truncated"))).toBe(true);
  });

  it("produces no title finding for a well-sized title", () => {
    const facts = extractHtmlFacts("<title>A Complete Guide to Local Plumbing Services</title>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.filter((f) => f.message.toLowerCase().includes("title"))).toHaveLength(0);
  });

  it("reports a warning when there is no meta description", () => {
    const facts = extractHtmlFacts("<title>A Complete Guide to Local Plumbing Services</title>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("meta description"))).toBe(true);
  });

  it("reports info for a too-short meta description", () => {
    const facts = extractHtmlFacts(
      '<title>A Complete Guide to Local Plumbing Services</title><meta name="description" content="Short one.">',
    );
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "info" && f.message.includes("Meta description"))).toBe(true);
  });
});
