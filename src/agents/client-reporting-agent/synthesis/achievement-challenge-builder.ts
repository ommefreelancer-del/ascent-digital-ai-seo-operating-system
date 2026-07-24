// Surfaces achievements and challenges from real, already-measured signals
// only -- per the spec's "Highlight achievements and challenges"
// responsibility. Every item traces to a real ranking/traffic trend, a real
// website audit finding count, or a real Core Web Vitals result; this
// builder never infers what work caused a change, since no
// activity-completion data is supplied to this agent.

import type { PerformanceAnalyticsResult } from "../../performance-analytics-agent/types/performance-analytics-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { AchievementOrChallenge } from "../types/client-reporting-request.types.js";

export class AchievementChallengeBuilder {
  build(performanceAnalytics: PerformanceAnalyticsResult, websiteAudit: WebsiteAuditResult): AchievementOrChallenge[] {
    const items: AchievementOrChallenge[] = [];

    for (const ranking of performanceAnalytics.rankingInsights) {
      if (ranking.trend === "improving") {
        items.push({
          type: "achievement",
          description: `"${ranking.keyword}" improved from position ${ranking.previousPosition} to ${ranking.currentPosition}.`,
        });
      } else if (ranking.trend === "declining") {
        items.push({
          type: "challenge",
          description: `"${ranking.keyword}" declined from position ${ranking.previousPosition} to ${ranking.currentPosition}.`,
        });
      }
    }

    const traffic = performanceAnalytics.trafficInsight;
    if (traffic?.trend === "improving") {
      items.push({ type: "achievement", description: `Organic sessions increased to ${traffic.organicSessions}.` });
    } else if (traffic?.trend === "declining") {
      items.push({ type: "challenge", description: `Organic sessions decreased to ${traffic.organicSessions}.` });
    }

    if (websiteAudit.summary.criticalCount > 0) {
      items.push({
        type: "challenge",
        description: `${websiteAudit.summary.criticalCount} critical website issue(s) remain unresolved.`,
      });
    } else {
      items.push({ type: "achievement", description: "No critical website issues are currently outstanding." });
    }

    for (const vital of performanceAnalytics.coreWebVitalInsights) {
      if (!vital.passesThreshold) {
        items.push({ type: "challenge", description: `${vital.metric} is not meeting Google's "good" threshold.` });
      }
    }

    return items;
  }
}
