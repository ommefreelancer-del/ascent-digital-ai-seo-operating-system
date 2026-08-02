import { describe, expect, it } from "vitest";
import { StructuredDataValidationChecker } from "../../../../src/agents/website-audit-agent/checks/structured-data-validation-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

describe("StructuredDataValidationChecker", () => {
  const checker = new StructuredDataValidationChecker();

  it("returns no findings when there is no structured data at all", () => {
    expect(checker.check(extractHtmlFacts("<html></html>"), CONTEXT)).toEqual([]);
  });

  it("skips blocks that failed to parse -- that's PageStructureChecker's job", () => {
    const html = `<script type="application/ld+json">{not valid}</script>`;
    expect(checker.check(extractHtmlFacts(html), CONTEXT)).toEqual([]);
  });

  it("reports info when a block has a valid @context and @type", () => {
    const html = `<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Organization", "name": "Ascent"}</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("warns when @type is missing", () => {
    const html = `<script type="application/ld+json">{"@context": "https://schema.org"}</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("@type"))).toBe(true);
  });

  it("warns when @context does not reference schema.org", () => {
    const html = `<script type="application/ld+json">{"@context": "https://example.com/other", "@type": "Organization"}</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("@context"))).toBe(true);
  });

  it("handles an array of JSON-LD entries", () => {
    const html = `<script type="application/ld+json">[
      {"@context": "https://schema.org", "@type": "Organization"},
      {"@type": "Person"}
    ]</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("@context"))).toBe(true);
  });

  it("does not flag a valid @graph container (which has no @type of its own) -- regression for a real false positive found via live-site testing", () => {
    const html = `<script type="application/ld+json">{
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "Organization", "name": "Ascent"},
        {"@type": "WebSite", "name": "Ascent"},
        {"@type": "Person", "name": "Omme"}
      ]
    }</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toContain("3 structured data block(s)");
  });

  it("warns per-entity when a @graph entity is missing @type, inheriting the graph's @context", () => {
    const html = `<script type="application/ld+json">{
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "Organization", "name": "Ascent"},
        {"name": "Missing type"}
      ]
    }</script>`;
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("@type"))).toBe(true);
    // Only the @type is missing for the second entity -- @context is correctly inherited, so it must not also be reported missing.
    expect(findings.some((f) => f.message.includes("@context") && f.message.includes("@type"))).toBe(false);
  });
});
