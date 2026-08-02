// Inspects real HTTP response headers recorded by the crawler for a set of
// well-known security/caching headers (CSP, Referrer-Policy, HSTS,
// Cache-Control, X-Frame-Options, X-Content-Type-Options). Only pages the
// crawler actually fetched (page.headers !== null) are evaluated -- a page
// that was never reached or was blocked by robots.txt has no real header
// evidence to check, so it is silently excluded rather than flagged.
//
// Findings are aggregated per missing/misconfigured header across the whole
// site (not one finding per page) to avoid flooding the report when many
// pages share the same server configuration -- the same pattern used by
// SiteWideInternalLinkingChecker.

import type { SiteAuditChecker } from "./site-audit-checker.js";
import type { CrawledPage, WebsiteCrawlResult } from "../../../core/crawling/website-crawler.js";
import type { AuditFinding, AuditSeverity } from "../types/website-audit-request.types.js";

function header(page: CrawledPage, name: string): string | null {
  return page.headers?.[name] ?? null;
}

function isHttps(page: CrawledPage): boolean {
  const url = page.finalUrl ?? page.url;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function summarizeUrls(pages: readonly CrawledPage[]): string {
  const urls = pages.map((p) => p.finalUrl ?? p.url);
  return `${urls.slice(0, 5).join(", ")}${urls.length > 5 ? `, and ${urls.length - 5} more` : ""}`;
}

interface HeaderRule {
  readonly key: string;
  readonly severity: AuditSeverity;
  readonly label: string;
  readonly recommendation: string;
  /** Restrict this rule to a subset of pages (e.g. HSTS only makes sense on HTTPS pages). */
  readonly applicablePages: (pages: readonly CrawledPage[]) => readonly CrawledPage[];
  /** Returns true if the page's header value is missing/misconfigured. */
  readonly isMissing: (page: CrawledPage) => boolean;
}

const RULES: readonly HeaderRule[] = [
  {
    key: "content-security-policy",
    severity: "warning",
    label: "Content-Security-Policy",
    recommendation: "Add a Content-Security-Policy header to restrict which sources of scripts, styles, and other resources the browser will load, reducing XSS risk.",
    applicablePages: (pages) => pages,
    isMissing: (page) => header(page, "content-security-policy") === null,
  },
  {
    key: "strict-transport-security",
    severity: "warning",
    label: "Strict-Transport-Security (HSTS)",
    recommendation: "Add a Strict-Transport-Security header on HTTPS responses so browsers refuse to fall back to an insecure HTTP connection.",
    applicablePages: (pages) => pages.filter(isHttps),
    isMissing: (page) => header(page, "strict-transport-security") === null,
  },
  {
    key: "x-frame-options",
    severity: "warning",
    label: "X-Frame-Options",
    recommendation: "Add an X-Frame-Options header (e.g. \"DENY\" or \"SAMEORIGIN\"), or an equivalent Content-Security-Policy frame-ancestors directive, to prevent clickjacking via iframes.",
    applicablePages: (pages) => pages,
    isMissing: (page) => header(page, "x-frame-options") === null && !(header(page, "content-security-policy") ?? "").toLowerCase().includes("frame-ancestors"),
  },
  {
    key: "x-content-type-options",
    severity: "warning",
    label: "X-Content-Type-Options",
    recommendation: 'Add "X-Content-Type-Options: nosniff" to stop browsers from MIME-sniffing responses away from the declared Content-Type.',
    applicablePages: (pages) => pages,
    isMissing: (page) => (header(page, "x-content-type-options") ?? "").toLowerCase() !== "nosniff",
  },
  {
    key: "referrer-policy",
    severity: "info",
    label: "Referrer-Policy",
    recommendation: 'Add a Referrer-Policy header (e.g. "strict-origin-when-cross-origin") to control how much referrer information is sent to other sites.',
    applicablePages: (pages) => pages,
    isMissing: (page) => header(page, "referrer-policy") === null,
  },
  {
    key: "cache-control",
    severity: "info",
    label: "Cache-Control",
    recommendation: "Add a Cache-Control header so browsers and CDNs know how long each response can be cached, improving repeat-visit performance.",
    applicablePages: (pages) => pages,
    isMissing: (page) => header(page, "cache-control") === null,
  },
];

export class HeaderSecurityChecker implements SiteAuditChecker {
  readonly category = "http-header-security";

  check(crawl: WebsiteCrawlResult): AuditFinding[] {
    const fetchedPages = crawl.pages.filter((page) => page.headers !== null);
    if (fetchedPages.length === 0) {
      return [];
    }

    const findings: AuditFinding[] = [];
    for (const rule of RULES) {
      const applicable = rule.applicablePages(fetchedPages);
      if (applicable.length === 0) continue;
      const missing = applicable.filter(rule.isMissing);
      if (missing.length === 0) continue;
      findings.push({
        category: this.category,
        severity: rule.severity,
        message: `${missing.length} of ${applicable.length} checked page(s) are missing (or misconfigured for) the ${rule.label} header: ${summarizeUrls(missing)}.`,
        recommendation: rule.recommendation,
      });
    }

    if (findings.length === 0) {
      findings.push({
        category: this.category,
        severity: "info",
        message: `All ${fetchedPages.length} checked page(s) returned the expected security-related HTTP response headers.`,
        recommendation: "No action required.",
      });
    }

    return findings;
  }
}
