// Flags internal links whose target page was actually crawled and found to
// be broken (HTTP 4xx/5xx, or a real fetch error) -- never a guess. A link
// to a page outside the crawl (beyond maxPages, or blocked by robots.txt) is
// deliberately NOT flagged as broken here, since that would be an
// unverified assumption; it is simply not evaluated.

import { extractHtmlFacts } from "../parsing/html-fact-extractor.js";
import { normalizeUrl } from "../util/normalize-url.js";
import type { SiteAuditChecker } from "./site-audit-checker.js";
import type { WebsiteCrawlResult, CrawledPage } from "../../../core/crawling/website-crawler.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

const IGNORED_SCHEMES = ["mailto:", "tel:", "javascript:"];

function toOriginPathSearch(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

export class BrokenLinkChecker implements SiteAuditChecker {
  readonly category = "broken-links";

  check(crawl: WebsiteCrawlResult): AuditFinding[] {
    const pageByUrl = new Map<string, CrawledPage>(crawl.pages.map((p) => [p.url, p]));
    const brokenTargets = new Map<string, { status: number | null; error: string | null; sources: Set<string> }>();

    for (const page of crawl.pages) {
      if (!page.html || !page.finalUrl) continue;
      const facts = extractHtmlFacts(page.html);
      for (const link of facts.links) {
        const href = link.href.trim();
        if (!href || href === "#" || IGNORED_SCHEMES.some((s) => href.startsWith(s))) continue;
        const absolute = normalizeUrl(href, page.finalUrl);
        if (!absolute) continue;
        let target: URL;
        try {
          target = new URL(absolute);
        } catch {
          continue;
        }
        const normalized = toOriginPathSearch(target);
        const targetPage = pageByUrl.get(normalized);
        if (!targetPage) continue; // Not crawled -- not verified, not flagged.
        const isBroken = targetPage.error !== null || (targetPage.status !== null && targetPage.status >= 400);
        if (!isBroken) continue;
        const existing = brokenTargets.get(normalized) ?? {
          status: targetPage.status,
          error: targetPage.error,
          sources: new Set<string>(),
        };
        existing.sources.add(page.url);
        brokenTargets.set(normalized, existing);
      }
    }

    if (brokenTargets.size === 0) {
      return [
        {
          category: this.category,
          severity: "info",
          message: "No broken internal links were found among the crawled pages.",
          recommendation: "No action required.",
        },
      ];
    }

    return Array.from(brokenTargets.entries()).map(([target, info]) => ({
      category: this.category,
      severity: "critical" as const,
      message: `Broken internal link to ${target} (${info.status ?? info.error}), linked from ${info.sources.size} page(s): ${Array.from(info.sources).slice(0, 3).join(", ")}${info.sources.size > 3 ? ", ..." : ""}.`,
      recommendation: `Fix or remove the link(s) to ${target}, or restore the page if it was removed by mistake.`,
    }));
  }
}
