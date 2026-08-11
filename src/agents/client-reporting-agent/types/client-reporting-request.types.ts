// Input/output shapes for the Client Reporting Agent, per
// Agents/client-reporting-agent.md. This agent does not fetch or measure
// anything itself -- it translates real, already-computed upstream results
// (PerformanceAnalyticsResult, WebsiteAuditResult, TechnicalSeoResult, and
// optionally SeoStrategyResult) into a client-friendly report. No new
// pluggable provider is introduced here: every number in this report
// traces to a real upstream result or to real, caller-supplied business
// KPIs -- never fabricated. This agent does not track or infer what SEO
// work was actually completed in a period (no activity-completion log is a
// declared input); the report covers current-state findings, rankings,
// audit results, and recommendations only, with that gap explicitly stated
// as a limitation, per GLOBAL_RULES.md SS1/SS2.

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { SeoStrategyResult } from "../../seo-strategy-agent/types/seo-strategy-request.types.js";
import type { SiteAuditResult } from "../../website-audit-agent/site-audit-orchestrator.js";

/** A real, caller-supplied business KPI figure (e.g. "$12,450 revenue", "38 leads"). Never invented. */
export interface BusinessKpiEntry {
  readonly label: string;
  readonly value: string;
}

export interface ClientReportingRequest {
  readonly id: string;
  readonly clientName: string;
  /** Real, caller-supplied label for the reporting window (e.g. "July 2026"). Never invented. */
  readonly reportingPeriodLabel: string;
  readonly performanceAnalytics: PerformanceAnalyticsResult;
  readonly websiteAudit: WebsiteAuditResult;
  readonly technicalSeo: TechnicalSeoResult;
  /** Optional: reflected in recommendations if supplied, otherwise its absence is stated as a limitation. */
  readonly seoStrategy?: SeoStrategyResult;
  readonly businessKpis?: readonly BusinessKpiEntry[];
  /** Optional: a multi-page SiteAuditResult (site-audit-orchestrator.ts). When supplied, enables the score card and priority matrix. */
  readonly siteAudit?: SiteAuditResult;
}

/** 0-100. A deterministic score computed from real finding severities/counts -- not an external benchmark or industry-standard metric. `null` only when the underlying real data needed to compute it was never available (e.g. no performance data provider configured). */
export type CategoryScore = number | null;

export interface ScoreCard {
  readonly overallSeoScore: CategoryScore;
  readonly technicalSeoScore: CategoryScore;
  readonly contentScore: CategoryScore;
  readonly performanceScore: CategoryScore;
  readonly accessibilityScore: CategoryScore;
  readonly uxScore: CategoryScore;
  readonly securityScore: CategoryScore;
  readonly aiSeoReadinessScore: CategoryScore;
  /** Explains what each score was computed from and why any are `null`. */
  readonly limitations: readonly string[];
}

export type PriorityBucket = "critical" | "high" | "medium" | "low";
export type EstimatedImpact = "high" | "medium" | "low";
export type EstimatedEffort = "high" | "medium" | "low";

export interface PrioritizedFinding {
  readonly category: string;
  readonly severity: "info" | "warning" | "critical";
  readonly message: string;
  readonly recommendation: string;
  readonly bucket: PriorityBucket;
  /** From a deterministic category-based rubric -- not a verified measurement or time estimate. */
  readonly estimatedImpact: EstimatedImpact;
  readonly estimatedEffort: EstimatedEffort;
  /** The page URL this finding came from, or `null` for a site-wide finding. */
  readonly pageUrl: string | null;
}

export interface PriorityMatrix {
  readonly critical: readonly PrioritizedFinding[];
  readonly high: readonly PrioritizedFinding[];
  readonly medium: readonly PrioritizedFinding[];
  readonly low: readonly PrioritizedFinding[];
}

/** "unknown" when there is no real comparative signal to report a trend from -- never guessed. */
export type KpiTrend = "improving" | "declining" | "stable" | "unknown";

export interface KpiDashboardEntry {
  readonly label: string;
  readonly value: string;
  readonly trend: KpiTrend;
}

export type AchievementOrChallengeType = "achievement" | "challenge";

export interface AchievementOrChallenge {
  readonly type: AchievementOrChallengeType;
  readonly description: string;
}

export type ClientRecommendationPriority = "high" | "medium" | "low";

export interface ClientRecommendation {
  readonly priority: ClientRecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface ClientReportingResult {
  readonly requestId: string;
  readonly clientName: string;
  readonly reportingPeriodLabel: string;
  readonly executiveSummary: string;
  readonly kpiDashboard: readonly KpiDashboardEntry[];
  readonly achievementsAndChallenges: readonly AchievementOrChallenge[];
  readonly recommendations: readonly ClientRecommendation[];
  /** `null` unless a SiteAuditResult was supplied on the request. */
  readonly scoreCard: ScoreCard | null;
  /** `null` unless a SiteAuditResult was supplied on the request. */
  readonly priorityMatrix: PriorityMatrix | null;
  /** Mirrors performanceAnalytics.dataAvailable -- false means no real measured performance data was available. */
  readonly dataAvailable: boolean;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
