// Shared contract for a SITE-LEVEL check -- one that needs the full crawl
// result (every page's real status code, redirect chain, and links) rather
// than a single page's facts. This is a separate interface from
// AuditChecker (checks/audit-checker.ts) on purpose: AuditChecker's
// single-page contract cannot express "is this link, discovered on page A,
// actually reachable" without knowing what the crawler found when it
// visited that link's target -- information that only exists once multiple
// pages have been crawled.

import type { WebsiteCrawlResult } from "../../../core/crawling/website-crawler.js";
import type { AuditFinding } from "../types/website-audit-request.types.js";

export interface SiteAuditChecker {
  readonly category: string;
  check(crawl: WebsiteCrawlResult): AuditFinding[];
}
