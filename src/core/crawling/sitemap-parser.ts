// Pure, dependency-free sitemap.xml parsing (urlset and sitemapindex).
// Regex-based, matching this project's established lightweight-parsing
// approach for constrained text formats -- a real, valid sitemap.xml
// document is expected; malformed input degrades to an empty result rather
// than throwing, since a missing/broken sitemap is itself a normal audit
// finding, not a parse error.

export interface ParsedSitemap {
  readonly isIndex: boolean;
  /** Real page URLs listed in a <urlset> sitemap. Empty for a sitemap index. */
  readonly urls: readonly string[];
  /** Child sitemap URLs listed in a <sitemapindex>. Empty for a plain urlset. */
  readonly childSitemaps: readonly string[];
}

function extractLocValues(xml: string, containerTag: "url" | "sitemap"): string[] {
  const values: string[] = [];
  const containerPattern = new RegExp(`<${containerTag}\\b[^>]*>([\\s\\S]*?)<\\/${containerTag}>`, "gi");
  for (const containerMatch of xml.matchAll(containerPattern)) {
    const block = containerMatch[1];
    if (block === undefined) continue;
    const locMatch = /<loc[^>]*>([\s\S]*?)<\/loc>/i.exec(block);
    const raw = locMatch?.[1];
    if (raw !== undefined) {
      values.push(raw.trim().replace(/&amp;/g, "&"));
    }
  }
  return values;
}

export function parseSitemapXml(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex\b/i.test(xml);
  if (isIndex) {
    return { isIndex: true, urls: [], childSitemaps: extractLocValues(xml, "sitemap") };
  }
  return { isIndex: false, urls: extractLocValues(xml, "url"), childSitemaps: [] };
}
