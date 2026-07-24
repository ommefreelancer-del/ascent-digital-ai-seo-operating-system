// Input/output shapes for the Website Audit Agent, per
// Agents/website-audit-agent.md. This build performs a STRUCTURAL audit
// only: it never fetches external SEO metrics (no Ahrefs/SEMrush/Search
// Console calls), and per the explicit instruction to keep this module
// deterministic, it never fetches the page itself over the network either --
// the caller supplies the real HTML (and optionally the real robots.txt
// content) directly. `url` is accepted only as context for checks that need
// to know the page's own address (canonical self-reference, HTTPS,
// robots.txt path matching) -- it is never dereferenced.

export type AuditSeverity = "info" | "warning" | "critical";

export interface WebsiteAuditRequest {
  readonly id: string;
  /** The page's real HTML, supplied by the caller. Required -- never fetched by this agent. */
  readonly html: string;
  /** The page's real URL, for context only (canonical/HTTPS/robots.txt path checks). Never fetched. */
  readonly url?: string;
  /** The site's real robots.txt content, supplied by the caller. Enables Disallow/Sitemap checks if present. */
  readonly robotsTxtContent?: string;
}

export interface AuditFinding {
  readonly category: string;
  readonly severity: AuditSeverity;
  readonly message: string;
  readonly recommendation: string;
}

export interface WebsiteAuditSummary {
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

export interface WebsiteAuditResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly findings: readonly AuditFinding[];
  readonly summary: WebsiteAuditSummary;
  /** Explicit scope/data-availability disclaimers -- never silently omitted. */
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
