// Pure, dependency-free extraction of the structural facts every checker
// needs from raw HTML. Deliberately a lightweight pattern-matching pass, not
// a full DOM/browser engine -- consistent with this project's existing
// approach to parsing constrained text formats (see
// src/boss-agent/registry/agent-spec-parser.ts). This means deeply malformed
// or JavaScript-rendered HTML may not be fully captured; that limitation is
// surfaced explicitly by WebsiteAuditAgent, not hidden.
//
// Every extractor here returns `null`/empty rather than throwing when
// something is absent -- absence (no title, no canonical tag, etc.) is a
// normal, expected audit finding, not a parse error.

export interface HeadingFact {
  readonly level: number;
  readonly text: string;
}

export interface LinkFact {
  readonly href: string;
}

export interface ImageFact {
  readonly src: string;
  /** `null` means the alt attribute is entirely absent; `""` means present but empty. */
  readonly alt: string | null;
}

export interface ExtractedHtmlFacts {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly metaRobots: string | null;
  readonly canonicalHref: string | null;
  readonly headings: readonly HeadingFact[];
  readonly links: readonly LinkFact[];
  readonly images: readonly ImageFact[];
  readonly structuredDataBlocks: readonly string[];
  readonly hasDoctype: boolean;
  readonly htmlLang: string | null;
  readonly hasViewportMeta: boolean;
  readonly hasHtmlTag: boolean;
  readonly hasBodyTag: boolean;
}

function firstMatch(pattern: RegExp, text: string): string | null {
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }
  const group = match[1];
  return group !== undefined ? group : null;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function extractTitle(html: string): string | null {
  const raw = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  return raw !== null ? collapseWhitespace(stripTags(raw)) : null;
}

function extractMetaContentByName(html: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]*\\bname=["']${escapedName}["'][^>]*\\bcontent=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]*\\bcontent=["']([^"']*)["'][^>]*\\bname=["']${escapedName}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = firstMatch(pattern, html);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function extractCanonicalHref(html: string): string | null {
  const patterns = [
    /<link[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']*)["']/i,
    /<link[^>]*\bhref=["']([^"']*)["'][^>]*\brel=["']canonical["']/i,
  ];
  for (const pattern of patterns) {
    const value = firstMatch(pattern, html);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function extractHeadings(html: string): HeadingFact[] {
  const headings: HeadingFact[] = [];
  const pattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const level = match[1];
    const text = match[2];
    if (level === undefined || text === undefined) {
      continue;
    }
    headings.push({ level: Number.parseInt(level, 10), text: collapseWhitespace(stripTags(text)) });
  }
  return headings;
}

function extractLinks(html: string): LinkFact[] {
  const links: LinkFact[] = [];
  const pattern = /<a\b[^>]*\bhref=["']([^"']*)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    if (href !== undefined) {
      links.push({ href });
    }
  }
  return links;
}

function extractImages(html: string): ImageFact[] {
  const images: ImageFact[] = [];
  const tagPattern = /<img\b[^>]*>/gi;
  for (const tagMatch of html.matchAll(tagPattern)) {
    const tag = tagMatch[0];
    const src = firstMatch(/\bsrc=["']([^"']*)["']/i, tag) ?? "";
    const hasAltAttribute = /\balt=/i.test(tag);
    const alt = hasAltAttribute ? (firstMatch(/\balt=["']([^"']*)["']/i, tag) ?? "") : null;
    images.push({ src, alt });
  }
  return images;
}

function extractStructuredDataBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<script[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const content = match[1];
    if (content !== undefined) {
      blocks.push(content.trim());
    }
  }
  return blocks;
}

function extractHtmlLang(html: string): string | null {
  return firstMatch(/<html[^>]*\blang=["']([^"']*)["']/i, html);
}

export function extractHtmlFacts(html: string): ExtractedHtmlFacts {
  return {
    title: extractTitle(html),
    metaDescription: extractMetaContentByName(html, "description"),
    metaRobots: extractMetaContentByName(html, "robots"),
    canonicalHref: extractCanonicalHref(html),
    headings: extractHeadings(html),
    links: extractLinks(html),
    images: extractImages(html),
    structuredDataBlocks: extractStructuredDataBlocks(html),
    hasDoctype: /<!doctype\s+html/i.test(html),
    htmlLang: extractHtmlLang(html),
    hasViewportMeta: /<meta[^>]*\bname=["']viewport["']/i.test(html),
    hasHtmlTag: /<html[\s>]/i.test(html),
    hasBodyTag: /<body[\s>]/i.test(html),
  };
}
