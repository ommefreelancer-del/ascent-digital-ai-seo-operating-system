import { describe, expect, it } from "vitest";
import { extractHtmlFacts } from "../../../../src/agents/website-audit-agent/parsing/html-fact-extractor.js";

const FULL_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>  Best Plumbers in Town  </title>
  <meta name="description" content="A great plumbing company.">
  <meta name="robots" content="noindex, nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/plumbers">
  <script type="application/ld+json">{"@type": "LocalBusiness"}</script>
</head>
<body>
  <h1>Plumbing <span>Services</span></h1>
  <h2>Our Services</h2>
  <h1>Second H1</h1>
  <p><a href="/about">About</a> <a href="https://external.com/x">External</a> <a href="#">Placeholder</a></p>
  <img src="/a.jpg" alt="A plumber at work">
  <img src="/b.jpg" alt="">
  <img src="/c.jpg">
</body>
</html>
`;

describe("extractHtmlFacts", () => {
  it("extracts and trims the title", () => {
    expect(extractHtmlFacts(FULL_PAGE).title).toBe("Best Plumbers in Town");
  });

  it("extracts meta description regardless of attribute order", () => {
    const facts = extractHtmlFacts(FULL_PAGE);
    expect(facts.metaDescription).toBe("A great plumbing company.");
  });

  it("extracts meta robots content", () => {
    expect(extractHtmlFacts(FULL_PAGE).metaRobots).toBe("noindex, nofollow");
  });

  it("extracts the canonical href", () => {
    expect(extractHtmlFacts(FULL_PAGE).canonicalHref).toBe("https://example.com/plumbers");
  });

  it("extracts all headings with their levels, stripping nested tags", () => {
    const headings = extractHtmlFacts(FULL_PAGE).headings;
    expect(headings).toEqual([
      { level: 1, text: "Plumbing Services" },
      { level: 2, text: "Our Services" },
      { level: 1, text: "Second H1" },
    ]);
  });

  it("extracts all link hrefs", () => {
    const links = extractHtmlFacts(FULL_PAGE).links;
    expect(links.map((l) => l.href)).toEqual(["/about", "https://external.com/x", "#"]);
  });

  it("distinguishes missing, empty, and present alt attributes", () => {
    const images = extractHtmlFacts(FULL_PAGE).images;
    expect(images).toEqual([
      { src: "/a.jpg", alt: "A plumber at work" },
      { src: "/b.jpg", alt: "" },
      { src: "/c.jpg", alt: null },
    ]);
  });

  it("extracts structured data blocks", () => {
    expect(extractHtmlFacts(FULL_PAGE).structuredDataBlocks).toEqual(['{"@type": "LocalBusiness"}']);
  });

  it("detects doctype, html lang, and viewport meta", () => {
    const facts = extractHtmlFacts(FULL_PAGE);
    expect(facts.hasDoctype).toBe(true);
    expect(facts.htmlLang).toBe("en");
    expect(facts.hasViewportMeta).toBe(true);
    expect(facts.hasHtmlTag).toBe(true);
    expect(facts.hasBodyTag).toBe(true);
  });

  it("returns null/empty/false for everything on an empty string", () => {
    const facts = extractHtmlFacts("");
    expect(facts.title).toBeNull();
    expect(facts.metaDescription).toBeNull();
    expect(facts.metaRobots).toBeNull();
    expect(facts.canonicalHref).toBeNull();
    expect(facts.headings).toEqual([]);
    expect(facts.links).toEqual([]);
    expect(facts.images).toEqual([]);
    expect(facts.structuredDataBlocks).toEqual([]);
    expect(facts.hasDoctype).toBe(false);
    expect(facts.htmlLang).toBeNull();
    expect(facts.hasViewportMeta).toBe(false);
    expect(facts.hasHtmlTag).toBe(false);
    expect(facts.hasBodyTag).toBe(false);
  });

  it("extracts meta tags with content before name in attribute order", () => {
    const html = '<meta content="Reversed order description" name="description">';
    expect(extractHtmlFacts(html).metaDescription).toBe("Reversed order description");
  });

  it("extracts a canonical tag with href before rel in attribute order", () => {
    const html = '<link href="https://example.com/reversed" rel="canonical">';
    expect(extractHtmlFacts(html).canonicalHref).toBe("https://example.com/reversed");
  });
});
