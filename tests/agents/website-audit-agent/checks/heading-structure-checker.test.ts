import { describe, expect, it } from "vitest";
import { HeadingStructureChecker } from "../../../../src/agents/website-audit-agent/checks/heading-structure-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("HeadingStructureChecker", () => {
  const checker = new HeadingStructureChecker();

  it("reports critical when there is no h1", () => {
    const facts = extractHtmlFacts("<h2>Only an h2</h2>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("reports a warning when there are multiple h1s", () => {
    const facts = extractHtmlFacts("<h1>One</h1><h1>Two</h1>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("2 <h1>"))).toBe(true);
  });

  it("reports a warning when a heading level is skipped", () => {
    const facts = extractHtmlFacts("<h1>Title</h1><h3>Skipped to h3</h3>");
    const findings = checker.check(facts, CONTEXT);
    expect(findings.some((f) => f.message.includes("skipping a level"))).toBe(true);
  });

  it("produces no findings for one h1 and a clean hierarchy", () => {
    const facts = extractHtmlFacts("<h1>Title</h1><h2>Section</h2><h3>Subsection</h3>");
    expect(checker.check(facts, CONTEXT)).toEqual([]);
  });
});
