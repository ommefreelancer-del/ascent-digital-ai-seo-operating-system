// Validates a proposed sitemap.xml BEFORE it is ever shown to a human for
// approval -- the ANTI-LOOP safeguard: a caller must never present an
// approval card for a sitemap this system can already tell is incomplete,
// invalid, or contains something it shouldn't (a duplicate, an off-site URL,
// a placeholder domain). Runs at the one seam every caller of
// planSitemapRemediation() shares (see that module's own wiring of this),
// rather than relying on each caller to remember to check independently.
// Pure and read-only: never repairs, rewrites, or filters the proposal --
// only reports, honestly, whether it is fit to present.

import { parseSitemapXml } from "../../core/crawling/sitemap-parser.js";

const PLACEHOLDER_HOSTS = new Set(["example.com", "www.example.com", "localhost", "127.0.0.1"]);

export interface SitemapValidationResult {
  readonly valid: boolean;
  /** Empty when valid:true. Every real, specific reason validation failed when valid:false -- never a generic "invalid" message. */
  readonly reasons: readonly string[];
}

/**
 * Checks the proposed sitemap XML against the real evidence it was supposed
 * to be built from (`siteUrl`, `crawledUrls`) -- never trusts that the
 * generator upstream did the right thing, so a future regression in that
 * generator still gets caught here before a human ever sees it.
 */
export function validateProposedSitemap(xml: string, siteUrl: string, crawledUrls: readonly string[]): SitemapValidationResult {
  const reasons: string[] = [];

  const parsed = parseSitemapXml(xml);
  if (parsed.isIndex) {
    reasons.push("Proposed content is a sitemap index, not a urlset -- expected a plain sitemap listing real page URLs.");
  }
  const urls = parsed.urls;
  if (urls.length === 0) {
    reasons.push("Proposed sitemap contains 0 URLs.");
  }

  let siteOrigin: string | null = null;
  try {
    siteOrigin = new URL(siteUrl).origin;
  } catch {
    reasons.push(`Site URL "${siteUrl}" is not a valid absolute URL.`);
  }

  const seen = new Set<string>();
  for (const url of urls) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reasons.push(`Proposed sitemap contains a syntactically invalid URL: "${url}".`);
      continue;
    }

    if (PLACEHOLDER_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
      reasons.push(`Proposed sitemap contains a placeholder/example URL: "${url}".`);
    }
    if (siteOrigin !== null && parsedUrl.origin !== siteOrigin) {
      reasons.push(`Proposed sitemap contains a URL that does not belong to the target site: "${url}".`);
    }
    if (seen.has(url)) {
      reasons.push(`Proposed sitemap contains a duplicate URL: "${url}".`);
    }
    seen.add(url);
  }

  // A real, successfully-crawled page silently missing from the final XML is
  // exactly the original incident (blog articles the crawler DID reach never
  // reaching the proposal) -- catch it independently of trusting that the
  // generator round-tripped `crawledUrls` correctly.
  const urlSet = new Set(urls);
  for (const crawledUrl of crawledUrls) {
    if (!urlSet.has(crawledUrl)) {
      reasons.push(`A real, successfully-crawled page is missing from the proposed sitemap: "${crawledUrl}".`);
    }
  }

  return { valid: reasons.length === 0, reasons };
}
