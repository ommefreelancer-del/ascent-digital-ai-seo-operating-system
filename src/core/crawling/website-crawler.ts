// Real multi-page crawling: fetches robots.txt, discovers sitemap.xml (from
// robots.txt Sitemap: lines, falling back to /sitemap.xml), then crawls
// every internal page reachable from the start URL plus every same-origin
// sitemap URL (breadth-first, bounded by maxPages). Every page's real HTTP
// status and real redirect chain is recorded -- this is genuine crawl
// evidence for the site-level checks (broken links, redirect chains,
// internal-linking graph) that WebsiteAuditAgent's single-page contract
// cannot produce on its own.

import { fetchHtmlWithDetails, FetchHtmlError } from "./fetch-html.js";
import { parseRobotsTxt, isPathAllowed, type ParsedRobotsTxt } from "./robots-txt-parser.js";
import { parseSitemapXml } from "./sitemap-parser.js";
import { extractHtmlFacts } from "../../agents/website-audit-agent/parsing/html-fact-extractor.js";
import { normalizeUrl } from "../../agents/website-audit-agent/util/normalize-url.js";

export interface CrawledPage {
  readonly url: string;
  readonly finalUrl: string | null;
  readonly status: number | null;
  readonly html: string | null;
  readonly redirectChain: readonly string[];
  readonly discoveredFrom: string | null;
  readonly error: string | null;
  /** Real response headers from the final hop, or `null` if the page could not be fetched. */
  readonly headers: Readonly<Record<string, string>> | null;
}

export interface WebsiteCrawlResult {
  readonly startUrl: string;
  readonly pages: readonly CrawledPage[];
  readonly robotsTxt: ParsedRobotsTxt | null;
  /** The raw, unparsed robots.txt text, for callers that need to pass it through verbatim (e.g. WebsiteAuditRequest.robotsTxtContent). `null` if it could not be fetched. */
  readonly robotsTxtContent: string | null;
  readonly sitemapUrls: readonly string[];
  readonly limitations: readonly string[];
}

export interface WebsiteCrawlerOptions {
  readonly maxPages?: number;
  readonly respectRobotsTxt?: boolean;
  readonly userAgent?: string;
}

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_USER_AGENT = "ADASOS-Crawler/1.0";
const MAX_SITEMAP_INDEX_CHILDREN = 10;
const MAX_SITEMAP_CANDIDATES = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toOriginPathSearch(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

async function discoverSitemapUrls(origin: string, robotsTxt: ParsedRobotsTxt | null, limitations: string[]): Promise<string[]> {
  const sitemapUrls: string[] = [];
  const candidates = robotsTxt?.sitemaps.length ? [...robotsTxt.sitemaps] : [new URL("/sitemap.xml", origin).toString()];

  for (const sitemapUrl of candidates.slice(0, MAX_SITEMAP_CANDIDATES)) {
    try {
      const result = await fetchHtmlWithDetails(sitemapUrl);
      const parsed = parseSitemapXml(result.html);
      if (parsed.isIndex) {
        for (const child of parsed.childSitemaps.slice(0, MAX_SITEMAP_INDEX_CHILDREN)) {
          try {
            const childResult = await fetchHtmlWithDetails(child);
            sitemapUrls.push(...parseSitemapXml(childResult.html).urls);
          } catch (error) {
            limitations.push(`Child sitemap ${child} could not be fetched: ${errorMessage(error)}`);
          }
        }
      } else {
        sitemapUrls.push(...parsed.urls);
      }
    } catch (error) {
      limitations.push(`Sitemap ${sitemapUrl} could not be fetched: ${errorMessage(error)}`);
    }
  }
  return sitemapUrls;
}

export async function crawlWebsite(startUrl: string, options: WebsiteCrawlerOptions = {}): Promise<WebsiteCrawlResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const respectRobotsTxt = options.respectRobotsTxt ?? true;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const limitations: string[] = [];
  const origin = new URL(startUrl).origin;

  let robotsTxt: ParsedRobotsTxt | null = null;
  let robotsTxtContent: string | null = null;
  try {
    const result = await fetchHtmlWithDetails(new URL("/robots.txt", origin).toString());
    robotsTxtContent = result.html;
    robotsTxt = parseRobotsTxt(result.html);
  } catch (error) {
    limitations.push(`robots.txt could not be fetched: ${errorMessage(error)}`);
  }

  const sitemapUrls = await discoverSitemapUrls(origin, robotsTxt, limitations);

  const queue: { url: string; discoveredFrom: string | null }[] = [{ url: startUrl, discoveredFrom: null }];
  const sameOriginSitemapUrls = sitemapUrls.filter((u) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  });
  for (const seed of sameOriginSitemapUrls) {
    queue.push({ url: seed, discoveredFrom: "sitemap.xml" });
  }

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    if (!next) break;

    let targetUrl: URL;
    try {
      targetUrl = new URL(normalizeUrl(next.url, origin) ?? next.url);
    } catch {
      continue;
    }
    if (targetUrl.origin !== origin) continue;
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") continue;

    const normalized = toOriginPathSearch(targetUrl);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    if (respectRobotsTxt && robotsTxt && !isPathAllowed(robotsTxt, userAgent, targetUrl.pathname)) {
      pages.push({
        url: normalized,
        finalUrl: null,
        status: null,
        html: null,
        redirectChain: [],
        discoveredFrom: next.discoveredFrom,
        error: "Blocked by robots.txt Disallow rule -- not fetched.",
        headers: null,
      });
      continue;
    }

    try {
      const result = await fetchHtmlWithDetails(normalized);
      pages.push({
        url: normalized,
        finalUrl: result.finalUrl,
        status: result.status,
        html: result.html,
        redirectChain: result.redirectChain,
        discoveredFrom: next.discoveredFrom,
        error: null,
        headers: result.headers,
      });

      const facts = extractHtmlFacts(result.html);
      for (const link of facts.links) {
        const absolute = normalizeUrl(link.href, result.finalUrl);
        if (!absolute) continue;
        let linkUrl: URL;
        try {
          linkUrl = new URL(absolute);
        } catch {
          continue;
        }
        if (linkUrl.origin !== origin) continue;
        if (linkUrl.protocol !== "http:" && linkUrl.protocol !== "https:") continue;
        const linkNormalized = toOriginPathSearch(linkUrl);
        // Bound the queue itself, not just visited pages, so a page with an
        // enormous number of internal links cannot grow memory unboundedly.
        if (!visited.has(linkNormalized) && pages.length + queue.length < maxPages * 2) {
          queue.push({ url: linkNormalized, discoveredFrom: normalized });
        }
      }
    } catch (error) {
      pages.push({
        url: normalized,
        finalUrl: null,
        status: error instanceof FetchHtmlError ? (error.status ?? null) : null,
        html: null,
        redirectChain: [],
        discoveredFrom: next.discoveredFrom,
        error: errorMessage(error),
        headers: null,
      });
    }
  }

  if (pages.length >= maxPages) {
    limitations.push(`Crawl stopped at the configured maxPages limit (${maxPages}); some internal pages may not have been visited.`);
  }
  limitations.push("Only static HTML is crawled; content injected by client-side JavaScript after page load is not evaluated.");

  return { startUrl, pages, robotsTxt, robotsTxtContent, sitemapUrls, limitations };
}
