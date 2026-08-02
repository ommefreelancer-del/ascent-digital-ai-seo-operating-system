// Extraction of the structural facts every checker needs from raw HTML.
// Uses Cheerio (a real DOM parser, not a browser/JS engine) for anything
// that benefits from genuine tree structure -- title, meta tags, canonical,
// headings, links, images, Open Graph/Twitter Card tags, hreflang links,
// render-blocking resources, and structured-data JSON parsing. This means
// deeply malformed HTML is now handled the way a real parser handles it
// (error recovery), a meaningful upgrade over the previous regex-only pass.
//
// The five raw-structure checks (hasDoctype, htmlLang, hasViewportMeta,
// hasHtmlTag, hasBodyTag) stay regex-based on purpose: they exist to detect
// whether the *source document itself* actually contains these constructs
// (used by WebsiteAuditRequestValidator.looksAmbiguous to catch profoundly
// malformed input), and Cheerio's parser always synthesizes an <html>/<body>
// wrapper around whatever it's given -- checking cheerio's tree for these
// would make "missing <html> tag" impossible to ever detect.
//
// Every extractor here returns `null`/empty rather than throwing when
// something is absent -- absence (no title, no canonical tag, etc.) is a
// normal, expected audit finding, not a parse error. This also means
// JavaScript-rendered content is not evaluated; that limitation is surfaced
// explicitly by WebsiteAuditAgent and WebsiteCrawler, not hidden.

import * as cheerio from "cheerio";

export interface HeadingFact {
  readonly level: number;
  readonly text: string;
}

export interface LinkFact {
  readonly href: string;
  /** Collapsed, trimmed visible text content of the link. */
  readonly text: string;
  /** The link's aria-label attribute, or `null` if absent. */
  readonly ariaLabel: string | null;
}

export interface ImageFact {
  readonly src: string;
  /** `null` means the alt attribute is entirely absent; `""` means present but empty. */
  readonly alt: string | null;
}

export interface MetaTagFact {
  /** The tag's `property` (Open Graph) or `name` (Twitter Card) attribute value, e.g. "og:title". */
  readonly key: string;
  readonly content: string;
}

export interface HreflangFact {
  readonly hreflang: string;
  readonly href: string;
}

export interface RenderBlockingResourceFact {
  readonly type: "script" | "stylesheet";
  readonly url: string;
}

export interface StructuredDataBlockFact {
  /** The exact raw text inside the <script type="application/ld+json"> block. */
  readonly raw: string;
  /** The parsed JSON value, or `null` if `raw` is not valid JSON. */
  readonly parsed: unknown | null;
  /** The JSON.parse error message, or `null` if parsing succeeded. */
  readonly parseError: string | null;
}

export interface ExtractedHtmlFacts {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly metaRobots: string | null;
  readonly canonicalHref: string | null;
  readonly headings: readonly HeadingFact[];
  readonly links: readonly LinkFact[];
  readonly images: readonly ImageFact[];
  /** Raw, untouched inner text of every <script type="application/ld+json"> block. */
  readonly structuredDataBlocks: readonly string[];
  /** The same blocks, additionally JSON-parsed for real Schema.org validation. */
  readonly structuredData: readonly StructuredDataBlockFact[];
  readonly openGraphTags: readonly MetaTagFact[];
  readonly twitterCardTags: readonly MetaTagFact[];
  readonly hreflangLinks: readonly HreflangFact[];
  readonly renderBlockingResources: readonly RenderBlockingResourceFact[];
  readonly hasDoctype: boolean;
  readonly htmlLang: string | null;
  readonly hasViewportMeta: boolean;
  /** The viewport meta tag's raw content attribute value, or `null` if absent. */
  readonly viewportContent: string | null;
  readonly hasHtmlTag: boolean;
  readonly hasBodyTag: boolean;
  /** Whether a <main> element or role="main" landmark is present. */
  readonly hasMainLandmark: boolean;
}

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function firstMatch(pattern: RegExp, text: string): string | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const group = match[1];
  return group !== undefined ? group : null;
}

function extractMetaContentByName($: cheerio.CheerioAPI, name: string): string | null {
  let found: string | null = null;
  $("meta[name]").each((_, el) => {
    if (found !== null) return;
    const attrName = $(el).attr("name");
    if (attrName?.toLowerCase() === name) {
      found = $(el).attr("content") ?? null;
    }
  });
  return found;
}

function extractCanonicalHref($: cheerio.CheerioAPI): string | null {
  let found: string | null = null;
  $("link[rel]").each((_, el) => {
    if (found !== null) return;
    if ($(el).attr("rel")?.toLowerCase() === "canonical") {
      found = $(el).attr("href") ?? null;
    }
  });
  return found;
}

function extractHeadings($: cheerio.CheerioAPI): HeadingFact[] {
  const headings: HeadingFact[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const level = Number.parseInt(el.tagName.slice(1), 10);
    headings.push({ level, text: collapseWhitespace($(el).text()) });
  });
  return headings;
}

function extractLinks($: cheerio.CheerioAPI): LinkFact[] {
  const links: LinkFact[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href === undefined) return;
    const ariaLabel = $(el).attr("aria-label");
    links.push({ href, text: collapseWhitespace($(el).text()), ariaLabel: ariaLabel ?? null });
  });
  return links;
}

function extractHasMainLandmark($: cheerio.CheerioAPI): boolean {
  return $("main").length > 0 || $('[role="main"]').length > 0;
}

function extractImages($: cheerio.CheerioAPI): ImageFact[] {
  const images: ImageFact[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const alt = $(el).attr("alt");
    images.push({ src, alt: alt === undefined ? null : alt });
  });
  return images;
}

function extractStructuredData($: cheerio.CheerioAPI): { blocks: string[]; structuredData: StructuredDataBlockFact[] } {
  const blocks: string[] = [];
  const structuredData: StructuredDataBlockFact[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).html() ?? "").trim();
    blocks.push(raw);
    try {
      structuredData.push({ raw, parsed: JSON.parse(raw), parseError: null });
    } catch (error) {
      structuredData.push({ raw, parsed: null, parseError: error instanceof Error ? error.message : String(error) });
    }
  });
  return { blocks, structuredData };
}

function extractOpenGraphTags($: cheerio.CheerioAPI): MetaTagFact[] {
  const tags: MetaTagFact[] = [];
  $("meta[property]").each((_, el) => {
    const property = $(el).attr("property") ?? "";
    if (!property.toLowerCase().startsWith("og:")) return;
    const content = $(el).attr("content");
    if (content !== undefined) tags.push({ key: property, content });
  });
  return tags;
}

function extractTwitterCardTags($: cheerio.CheerioAPI): MetaTagFact[] {
  const tags: MetaTagFact[] = [];
  $("meta[name]").each((_, el) => {
    const name = $(el).attr("name") ?? "";
    if (!name.toLowerCase().startsWith("twitter:")) return;
    const content = $(el).attr("content");
    if (content !== undefined) tags.push({ key: name, content });
  });
  return tags;
}

function extractHreflangLinks($: cheerio.CheerioAPI): HreflangFact[] {
  const links: HreflangFact[] = [];
  $("link[rel]").each((_, el) => {
    if ($(el).attr("rel")?.toLowerCase() !== "alternate") return;
    const hreflang = $(el).attr("hreflang");
    const href = $(el).attr("href");
    if (hreflang !== undefined && href !== undefined) links.push({ hreflang, href });
  });
  return links;
}

function extractRenderBlockingResources($: cheerio.CheerioAPI): RenderBlockingResourceFact[] {
  const resources: RenderBlockingResourceFact[] = [];
  $("head script[src]").each((_, el) => {
    const $el = $(el);
    if ($el.attr("async") !== undefined || $el.attr("defer") !== undefined) return;
    if ($el.attr("type")?.toLowerCase() === "module") return;
    const src = $el.attr("src");
    if (src) resources.push({ type: "script", url: src });
  });
  $("head link[rel]").each((_, el) => {
    const $el = $(el);
    if ($el.attr("rel")?.toLowerCase() !== "stylesheet") return;
    if ($el.attr("media")?.toLowerCase() === "print") return;
    const href = $el.attr("href");
    if (href) resources.push({ type: "stylesheet", url: href });
  });
  return resources;
}

export function extractHtmlFacts(html: string): ExtractedHtmlFacts {
  const $ = cheerio.load(html);
  const title = $("title").first().text();
  const { blocks, structuredData } = extractStructuredData($);

  return {
    title: /<title[\s>]/i.test(html) ? collapseWhitespace(title) : null,
    metaDescription: extractMetaContentByName($, "description"),
    metaRobots: extractMetaContentByName($, "robots"),
    canonicalHref: extractCanonicalHref($),
    headings: extractHeadings($),
    links: extractLinks($),
    images: extractImages($),
    structuredDataBlocks: blocks,
    structuredData,
    openGraphTags: extractOpenGraphTags($),
    twitterCardTags: extractTwitterCardTags($),
    hreflangLinks: extractHreflangLinks($),
    renderBlockingResources: extractRenderBlockingResources($),
    hasDoctype: /<!doctype\s+html/i.test(html),
    htmlLang: firstMatch(/<html[^>]*\blang=["']([^"']*)["']/i, html),
    hasViewportMeta: /<meta[^>]*\bname=["']viewport["']/i.test(html),
    viewportContent:
      firstMatch(/<meta[^>]*\bname=["']viewport["'][^>]*\bcontent=["']([^"']*)["']/i, html) ??
      firstMatch(/<meta[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']viewport["']/i, html),
    hasHtmlTag: /<html[\s>]/i.test(html),
    hasBodyTag: /<body[\s>]/i.test(html),
    hasMainLandmark: extractHasMainLandmark($),
  };
}
