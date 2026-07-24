// Input/output shapes for the Competitor Intelligence Agent, per
// Agents/competitor-intelligence-agent.md. Competitors are never discovered
// automatically and never fetched -- the caller supplies each competitor's
// real HTML snapshot (and, if known, its real URL and robots.txt content)
// directly, mirroring the Website Audit Agent's own "html required, url is
// context only" contract. This agent internally reuses the real
// WebsiteAuditAgent to analyze each snapshot, so every comparison is
// grounded in an actual, freshly-computed structural audit -- never an
// invented competitor metric.

import type { KeywordResearchResult } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { TechnicalCategory } from "../analysis/technical-categories.js";

export interface CompetitorSnapshot {
  readonly id: string;
  /** The competitor page's real HTML, supplied by the caller. Never fetched. */
  readonly html: string;
  /** The competitor page's real URL, for context only. Never fetched. */
  readonly url?: string;
  /** The competitor's real robots.txt content, if known. Never fetched. */
  readonly robotsTxtContent?: string;
}

export interface CompetitorIntelligenceRequest {
  readonly id: string;
  readonly ourWebsiteAudit: WebsiteAuditResult;
  readonly ourTechnicalSeo: TechnicalSeoResult;
  readonly ourKeywordResearch: KeywordResearchResult;
  readonly competitors: readonly CompetitorSnapshot[];
}

export type CompetitorAssessment = "we_are_ahead" | "we_are_behind" | "comparable";

export interface CompetitorOverallGap {
  readonly competitorId: string;
  readonly competitorUrl: string | null;
  readonly ourTotalIssues: number;
  readonly competitorTotalIssues: number;
  readonly assessment: CompetitorAssessment;
}

export type ComparisonAdvantage = "us" | "competitor" | "tie";

export interface TechnicalCategoryComparison {
  readonly category: TechnicalCategory;
  readonly ourIssueCount: number;
  readonly competitorIssueCount: number;
  readonly advantage: ComparisonAdvantage;
}

export interface CompetitorTechnicalComparison {
  readonly competitorId: string;
  readonly competitorUrl: string | null;
  readonly categories: readonly TechnicalCategoryComparison[];
}

export interface ContentClusterCoverage {
  readonly clusterLabel: string;
  readonly keywords: readonly string[];
  /** ids of competitors whose title/heading text appears to address this cluster. */
  readonly coveredByCompetitors: readonly string[];
}

export type CompetitorRecommendationPriority = "high" | "medium" | "low";

export interface CompetitorActionableRecommendation {
  readonly category: string;
  readonly priority: CompetitorRecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface CompetitorIntelligenceResult {
  readonly requestId: string;
  readonly competitorGapAnalysis: readonly CompetitorOverallGap[];
  readonly technicalComparison: readonly CompetitorTechnicalComparison[];
  readonly contentGapAnalysis: readonly ContentClusterCoverage[];
  readonly recommendations: readonly CompetitorActionableRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
