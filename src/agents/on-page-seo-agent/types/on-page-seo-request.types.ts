// Input/output shapes for the On-Page SEO Agent, per
// Agents/on-page-seo-agent.md. Consumes real WebsiteAuditResult (from the
// Website Audit Agent) and KeywordResearchResult (from the Keyword Research
// Agent) -- every recommendation here is either (a) a direct response to an
// already-identified audit finding, or (b) generic, prescriptive on-page
// guidance tied to the caller-specified target keyword and its real
// classified intent. Nothing about page content, current text, or keyword
// metrics is invented: where this agent cannot know the real "before" state
// (e.g. exact current title text when the audit didn't flag a title
// problem), it recommends without pretending to know what it's replacing.

import type { KeywordResearchResult } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export interface OnPageSeoRequest {
  readonly id: string;
  readonly websiteAudit: WebsiteAuditResult;
  readonly keywordResearch: KeywordResearchResult;
  /** Must match (case-insensitively) a keyword already present in keywordResearch.classifiedKeywords. */
  readonly targetKeyword: string;
}

export type RecommendationPriority = "high" | "medium" | "low";

export interface OnPageRecommendation {
  readonly category: string;
  readonly priority: RecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface OnPageSeoResult {
  readonly requestId: string;
  readonly url: string | null;
  readonly targetKeyword: string;
  readonly recommendations: readonly OnPageRecommendation[];
  /** Critical/warning audit findings outside this agent's own scope (e.g. crawlability, HTTPS) -- surfaced, not silently dropped, and not "fixed" here since they belong to the Technical SEO Agent. */
  readonly crossFunctionalNotes: readonly string[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
