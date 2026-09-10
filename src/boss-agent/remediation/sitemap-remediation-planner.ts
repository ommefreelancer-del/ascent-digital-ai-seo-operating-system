// Turns a real, verified audit finding (sitemap.xml missing/empty) into a
// real, structured RemediationTask -- the THIRD remediation type this
// architecture ships with, following the exact same shape and discipline as
// robots-txt-remediation-planner.ts and canonical-url-remediation-planner.ts.
// Every field is grounded in real, already-computed crawl evidence: the
// sitemap entries this plans are drawn EXCLUSIVELY from `crawledUrls` --
// real, already-crawled, successfully-fetched page URLs (see
// web/src/server/backend/website-audit.ts's CrawlSummary.crawledUrls) --
// this module never fetches anything itself, never invents a URL that was
// not actually crawled, and never guesses page content.

import { randomUUID } from "node:crypto";
import type { RemediationTask } from "./remediation-task.types.js";
import { validateProposedSitemap } from "./validate-proposed-sitemap.js";

export interface SitemapPlanningInput {
  readonly workspaceId: string;
  /** The real, already-crawled site's canonical URL (CrawlSummary.startUrl). */
  readonly siteUrl: string;
  /** Real, already-measured evidence: how many URLs did the crawler's real sitemap.xml fetch discover? (CrawlSummary.sitemapUrlsFound) */
  readonly sitemapUrlsFound: number;
  /** Real, already-crawled, successfully-fetched page URLs from THIS SAME crawl (CrawlSummary.crawledUrls) -- the ONLY source for sitemap entries. Never invented, never supplied by a caller/LLM. */
  readonly crawledUrls: readonly string[];
}

const REQUIRED_CAPABILITY = "technical-remediation";
const REQUIRED_TOOL = "repository-file-write-and-deploy";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Builds a real, minimal, valid sitemap.xml (the sitemaps.org `urlset`
 * schema) listing ONLY the real, already-crawled URLs supplied -- never
 * invents, guesses, or pads with a URL that was not actually crawled. An
 * empty `crawledUrls` list produces an empty (but still well-formed) urlset
 * -- callers should refuse to plan a remediation task in that case (see
 * planSitemapRemediation()) rather than proposing a genuinely empty sitemap.
 */
export function buildProposedSitemapContent(crawledUrls: readonly string[]): string {
  const entries = crawledUrls.map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

/**
 * Returns a real, planned RemediationTask if the crawl evidence genuinely
 * shows sitemap.xml has no discoverable URLs AND at least one real page was
 * actually crawled to list, or `null` if there is nothing to remediate
 * (sitemap.xml already has real URLs) or nothing safe to propose (no real
 * crawled URLs exist to build a sitemap from) -- never fabricates a finding
 * or a URL that doesn't exist in the real evidence.
 */
export function planSitemapRemediation(input: SitemapPlanningInput): RemediationTask | null {
  if (input.sitemapUrlsFound > 0) {
    return null;
  }
  if (input.crawledUrls.length === 0) {
    return null;
  }

  const now = new Date().toISOString();
  // PROJECT-SITE TARGETING FIX (2026-08-22): unlike robots.txt (a real
  // web-crawler standard requiring the true domain root), a sitemap.xml has
  // no such constraint -- per the Sitemaps protocol it can live at any path
  // the site actually controls. Resolving it RELATIVE to the site's own
  // real URL (never an absolute "/sitemap.xml", which would silently
  // discard a GitHub Pages project-site's own path prefix and land on the
  // account's origin root instead) is what lets this remediation target the
  // site's own actual, controlled deployment -- confirmed live: a real
  // sitemap.xml already exists at this exact project-relative location.
  // Normalizes a missing trailing slash first so relative resolution always
  // treats siteUrl as a directory, never accidentally replacing its last
  // path segment.
  const siteBase = input.siteUrl.endsWith("/") ? input.siteUrl : `${input.siteUrl}/`;
  const sitemapUrl = new URL("sitemap.xml", siteBase).toString();
  const proposedAction = buildProposedSitemapContent(input.crawledUrls);

  // ANTI-LOOP / PRE-PROPOSAL VALIDATION (2026-09-10): never return a task
  // -- never let an approval card reach a human -- for a proposal this
  // system can already tell is incomplete, invalid, or contains something
  // it shouldn't (a duplicate, an off-site URL, a placeholder domain). This
  // is what stops the same known-bad proposal from repeatedly reaching
  // approval: if validation ever fails here, the honest, safe answer is
  // "nothing safe to propose" (null), exactly like the already-established
  // "no real crawled URLs" case above -- never a partially-broken proposal
  // shown anyway.
  const validation = validateProposedSitemap(proposedAction, input.siteUrl, input.crawledUrls);
  if (!validation.valid) {
    return null;
  }

  return {
    taskId: randomUUID(),
    workspaceId: input.workspaceId,
    findingId: `sitemap-empty:${input.siteUrl}`,
    affectedResource: sitemapUrl,
    evidence: `A real crawl of ${input.siteUrl} discovered ${input.crawledUrls.length} real page(s), but the site's own sitemap.xml fetch found 0 URL(s).`,
    diagnosis: `${sitemapUrl} is missing, empty, or does not list this site's real pages, reducing search engines' ability to efficiently discover them.`,
    requiredCapability: REQUIRED_CAPABILITY,
    requiredTool: REQUIRED_TOOL,
    proposedAction,
    approvalState: "not_required",
    executionState: "not_started",
    verificationState: "not_started",
    retryCount: 0,
    maxRetries: 2,
    verificationResumeCount: 0,
    maxVerificationResumes: 2,
    createdAt: now,
    updatedAt: now,
    finalStatus: "planned",
    failureReason: null,
    verificationEvidence: null,
    rollbackData: null,
  };
}
