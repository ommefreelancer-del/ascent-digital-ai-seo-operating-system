// Builds a plain-language executive summary paragraph from real inputs
// only -- per the spec's "Explain SEO results in client-friendly language"
// responsibility. A deterministic template, not an LLM-written narrative:
// every sentence states a real figure or explicitly says the figure is
// unavailable, never a smoothed-over or invented claim.

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export class ExecutiveSummaryBuilder {
  build(
    clientName: string,
    reportingPeriodLabel: string,
    performanceAnalytics: PerformanceAnalyticsResult,
    websiteAudit: WebsiteAuditResult,
  ): string {
    const sentences: string[] = [`This report summarizes ${clientName}'s SEO performance for ${reportingPeriodLabel}.`];

    const traffic = performanceAnalytics.trafficInsight;
    if (performanceAnalytics.dataAvailable && traffic) {
      const conversionsClause = traffic.conversions !== null ? `, with ${traffic.conversions} tracked conversion(s)` : "";
      sentences.push(`Organic sessions were ${traffic.organicSessions} (${traffic.trend})${conversionsClause}.`);
    } else {
      sentences.push("No measured performance data (rankings, traffic, or Core Web Vitals) was available for this period.");
    }

    sentences.push(
      `The website audit found ${websiteAudit.summary.criticalCount} critical and ` +
        `${websiteAudit.summary.warningCount} warning issue(s) remaining.`,
    );

    return sentences.join(" ");
  }
}
