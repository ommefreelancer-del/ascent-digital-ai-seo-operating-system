// Builds the 8 named scores (Overall/Technical/Content/Performance/
// Accessibility/UX/Security/AI-SEO-Readiness) from real, already-computed
// SiteAuditResult findings and PerformanceAnalyticsResult data. Every score
// is a deterministic function of real finding severities/counts (critical
// findings weigh more than warnings) -- this is a real, reproducible
// scoring CONVENTION for this codebase, not an external SEO benchmark, an
// industry-standard metric, or a ranking-factor weighting. A category with
// no real data to compute from (e.g. no performance data provider
// configured) scores `null`, never a fabricated 0 or 100.

import type { AuditFinding } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { SiteAuditResult } from "../../website-audit-agent/site-audit-orchestrator.js";
import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { CategoryScore, ScoreCard } from "../types/client-reporting-request.types.js";

const CRITICAL_PENALTY = 20;
const WARNING_PENALTY = 5;

const TECHNICAL_CATEGORIES = ["crawlability", "canonical", "robots-txt", "page-structure", "broken-links", "redirect-chains"];
const CONTENT_CATEGORIES = ["metadata", "headings"];
const ACCESSIBILITY_CATEGORIES = ["accessibility", "image-alt"];
const UX_CATEGORIES = ["mobile-friendliness", "site-wide-internal-linking", "internal-links"];
/** Distinct from TECHNICAL_CATEGORIES: this is specifically the HTTPS check (technical-seo-checker.ts). */
const SECURITY_CATEGORIES = ["technical-seo"];
const AI_SEO_READINESS_CATEGORIES = ["structured-data-validation", "open-graph", "twitter-card"];

function allFindings(siteAudit: SiteAuditResult): AuditFinding[] {
  const perPage = siteAudit.pageAudits.flatMap((p) => p.audit?.findings ?? []);
  return [...perPage, ...siteAudit.siteFindings];
}

function scoreForCategories(findings: readonly AuditFinding[], categories: readonly string[]): number {
  const set = new Set(categories);
  const relevant = findings.filter((f) => set.has(f.category));
  const criticalCount = relevant.filter((f) => f.severity === "critical").length;
  const warningCount = relevant.filter((f) => f.severity === "warning").length;
  const score = 100 - criticalCount * CRITICAL_PENALTY - warningCount * WARNING_PENALTY;
  return Math.max(0, Math.min(100, score));
}

function performanceScore(performanceAnalytics: PerformanceAnalyticsResult | null): CategoryScore {
  if (!performanceAnalytics || !performanceAnalytics.dataAvailable || performanceAnalytics.coreWebVitalInsights.length === 0) {
    return null;
  }
  const passing = performanceAnalytics.coreWebVitalInsights.filter((v) => v.passesThreshold).length;
  return Math.round((passing / performanceAnalytics.coreWebVitalInsights.length) * 100);
}

export class ScoreCardBuilder {
  build(siteAudit: SiteAuditResult, performanceAnalytics: PerformanceAnalyticsResult | null = null): ScoreCard {
    const findings = allFindings(siteAudit);

    const technicalSeoScore = scoreForCategories(findings, TECHNICAL_CATEGORIES);
    const contentScore = scoreForCategories(findings, CONTENT_CATEGORIES);
    const accessibilityScore = scoreForCategories(findings, ACCESSIBILITY_CATEGORIES);
    const uxScore = scoreForCategories(findings, UX_CATEGORIES);
    const securityScore = scoreForCategories(findings, SECURITY_CATEGORIES);
    const aiSeoReadinessScore = scoreForCategories(findings, AI_SEO_READINESS_CATEGORIES);
    const perf = performanceScore(performanceAnalytics);

    const numericScores = [technicalSeoScore, contentScore, accessibilityScore, uxScore, securityScore, aiSeoReadinessScore, perf].filter(
      (s): s is number => s !== null,
    );
    const overallSeoScore = numericScores.length > 0 ? Math.round(numericScores.reduce((a, b) => a + b, 0) / numericScores.length) : null;

    const limitations: string[] = [
      "Every score is a deterministic function of this run's real audit findings (critical findings weigh more than warnings); it is not an external SEO benchmark, industry-standard metric, or ranking-factor weighting.",
    ];
    if (perf === null) {
      limitations.push("Performance Score is null: no real Core Web Vitals data was available (no performance data provider configured, or the audit did not include a performance pass).");
    }

    return {
      overallSeoScore,
      technicalSeoScore,
      contentScore,
      performanceScore: perf,
      accessibilityScore,
      uxScore,
      securityScore,
      aiSeoReadinessScore,
      limitations,
    };
  }
}
