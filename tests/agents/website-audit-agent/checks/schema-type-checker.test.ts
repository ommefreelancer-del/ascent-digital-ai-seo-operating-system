import { describe, expect, it } from "vitest";
import { SchemaTypeChecker } from "../../../../src/agents/website-audit-agent/checks/schema-type-checker.js";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const CONTEXT = { url: null, robotsTxtContent: null };

function jsonLd(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

describe("SchemaTypeChecker", () => {
  const checker = new SchemaTypeChecker();

  it("returns no findings when there is no structured data at all", () => {
    expect(checker.check(extractHtmlFacts("<html></html>"), CONTEXT)).toEqual([]);
  });

  it("skips blocks that failed to parse", () => {
    const html = `<script type="application/ld+json">{not valid}</script>`;
    expect(checker.check(extractHtmlFacts(html), CONTEXT)).toEqual([]);
  });

  it("does not flag an unrecognized @type -- no fabricated type-specific result", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "SomeObscureType", name: "x" });
    expect(checker.check(extractHtmlFacts(html), CONTEXT)).toEqual([]);
  });

  it("reports info when a recognized type has all its required properties", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Ascent", url: "https://ascent.example" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
  });

  it("flags an Organization block missing url", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Ascent" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain("Organization");
    expect(findings[0]?.message).toContain("url");
  });

  it("flags a LocalBusiness block missing address", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "LocalBusiness", name: "Corner Cafe" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("LocalBusiness") && f.message.includes("address"))).toBe(true);
  });

  it("flags an Article block missing multiple required properties in one finding", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "Article", headline: "Title only" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("author");
    expect(findings[0]?.message).toContain("datePublished");
  });

  it("flags a BreadcrumbList missing itemListElement", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("BreadcrumbList") && f.message.includes("itemListElement"))).toBe(true);
  });

  it("flags an FAQPage missing mainEntity", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "FAQPage" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("FAQPage") && f.message.includes("mainEntity"))).toBe(true);
  });

  it("validates each entity inside a @graph container independently", () => {
    const html = jsonLd({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ascent", url: "https://ascent.example" },
        { "@type": "Person", name: "Omme" },
        { "@type": "LocalBusiness", name: "Missing address" },
      ],
    });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("LocalBusiness"))).toBe(true);
    expect(findings.some((f) => f.message.includes("Organization"))).toBe(false);
    expect(findings.some((f) => f.message.includes("\"Person\""))).toBe(false);
  });

  it("treats an empty-string or empty-array required property as missing", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "", url: "https://ascent.example" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("name"))).toBe(true);
  });

  it("handles an array @type by checking every recognized type name in it", () => {
    const html = jsonLd({ "@context": "https://schema.org", "@type": ["LocalBusiness", "Restaurant"], name: "Corner Cafe" });
    const findings = checker.check(extractHtmlFacts(html), CONTEXT);
    expect(findings.some((f) => f.message.includes("LocalBusiness") && f.message.includes("address"))).toBe(true);
  });
});
