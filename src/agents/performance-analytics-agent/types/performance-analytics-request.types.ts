// Input/output shapes for the Performance & Analytics Agent, per
// Agents/performance-analytics-agent.md. This agent consumes real upstream
// SEO outputs (KeywordResearchResult, WebsiteAuditResult, TechnicalSeoResult)
// plus whatever a PerformanceDataProvider can genuinely supply (rankings,
// traffic, Core Web Vitals). With no provider configured (the default),
// `dataAvailable` is false and every data-dependent field is empty/null --
// this agent never invents a ranking, traffic number, CTR, or conversion
// figure. ROI is estimated only from real, measured conversions and a real
// average conversion value; if either is unavailable, `roiInsight` is `null`.

import type { KeywordResearchResult } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { LighthouseCategoryScores } from "./performance-data-provider.types.js";

export interface PerformanceAnalyticsRequest {
  readonly id: string;
  readonly url: string;
  readonly keywordResearch: KeywordResearchResult;
  readonly websiteAudit: WebsiteAuditResult;
  readonly technicalSeo: TechnicalSeoResult;
}

/** "unknown" when there is no prior measurement to compare against -- never guessed. */
export type PerformanceTrend = "improving" | "declining" | "stable" | "unknown";

export interface RankingInsight {
  readonly keyword: string;
  readonly currentPosition: number;
  readonly previousPosition: number | null;
  readonly trend: PerformanceTrend;
  /** True when ranked 11-20 ("page 2") -- a real, computable proximity-to-page-one signal, not a fabricated score. */
  readonly isPageOneOpportunity: boolean;
}

export interface TrafficInsight {
  readonly organicSessions: number;
  readonly trend: PerformanceTrend;
  readonly conversions: number | null;
}

export type CoreWebVitalMetric = "LCP" | "INP" | "CLS";

export interface CoreWebVitalInsight {
  readonly metric: CoreWebVitalMetric;
  readonly value: number;
  /** Google's published "good" threshold for this metric -- a real, documented convention, not invented. */
  readonly threshold: number;
  readonly passesThreshold: boolean;
}

export type PerformanceOpportunityPriority = "high" | "medium" | "low";

export interface PerformanceOpportunity {
  readonly category: string;
  readonly description: string;
  readonly rationale: string;
  readonly priority: PerformanceOpportunityPriority;
}

export interface RoiInsight {
  readonly conversions: number;
  readonly averageConversionValue: number;
  readonly estimatedRevenue: number;
  readonly basis: string;
}

export type PerformanceRecommendationPriority = "high" | "medium" | "low";

export interface PerformanceRecommendation {
  readonly category: string;
  readonly priority: PerformanceRecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface PerformanceAnalyticsResult {
  readonly requestId: string;
  readonly url: string;
  /** False when no PerformanceDataProvider supplied real data -- every field below is then empty/null, never guessed. */
  readonly dataAvailable: boolean;
  readonly rankingInsights: readonly RankingInsight[];
  readonly trafficInsight: TrafficInsight | null;
  readonly coreWebVitalInsights: readonly CoreWebVitalInsight[];
  /** Real, measured Lighthouse category scores (Performance/Accessibility/Best Practices/SEO), passed through unmodified from the provider. `null` when unavailable -- never estimated. */
  readonly lighthouseCategoryScores: LighthouseCategoryScores | null;
  readonly opportunities: readonly PerformanceOpportunity[];
  readonly roiInsight: RoiInsight | null;
  readonly recommendations: readonly PerformanceRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
