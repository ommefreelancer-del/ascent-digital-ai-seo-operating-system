// Input/output shapes for the Technical SEO Agent, per
// Agents/technical-seo-agent.md. This build covers exactly the technical
// categories the On-Page SEO Agent's CrossFunctionalNotesBuilder flags as
// outside its own scope -- crawlability, robots.txt (Disallow/Sitemap),
// HTTPS, and basic page structure (doctype/lang/viewport) -- since those are
// the only technical categories the Website Audit Agent can determine
// without a real crawl or external API. Core Web Vitals, page speed, crawl
// error reports, and JS-rendering analysis all require real external data
// (Search Console, PageSpeed Insights) this build does not have, and are
// explicitly out of scope (see the standing limitation the facade always
// includes).

import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export interface TechnicalSeoRequest {
  readonly id: string;
  readonly websiteAudit: WebsiteAuditResult;
  /** The On-Page SEO Agent's own OnPageSeoResult.crossFunctionalNotes for the same page. */
  readonly crossFunctionalNotes: readonly string[];
}

export type TechnicalSeoPriority = "high" | "medium" | "low";

export interface TechnicalSeoRecommendation {
  readonly category: string;
  readonly priority: TechnicalSeoPriority;
  readonly recommendation: string;
  readonly rationale: string;
  /** True when another agent's cross-functional note independently flagged the same underlying finding. */
  readonly confirmedByCrossFunctionalNote: boolean;
}

export interface TechnicalSeoResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly recommendations: readonly TechnicalSeoRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
