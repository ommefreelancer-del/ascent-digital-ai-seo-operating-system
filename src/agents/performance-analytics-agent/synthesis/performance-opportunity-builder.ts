// Identifies SEO opportunities from real, measured performance trends
// (rankings, traffic, Core Web Vitals) -- per the spec's "Identify SEO
// opportunities from performance trends" responsibility. Every opportunity
// traces to a real insight already computed from real data; this builder
// invents nothing and produces zero opportunities when no insights exist.

import type {
  CoreWebVitalInsight,
  PerformanceOpportunity,
  RankingInsight,
  TrafficInsight,
} from "../types/performance-analytics-request.types.js";

export class PerformanceOpportunityBuilder {
  build(
    rankingInsights: readonly RankingInsight[],
    trafficInsight: TrafficInsight | null,
    coreWebVitalInsights: readonly CoreWebVitalInsight[],
  ): PerformanceOpportunity[] {
    const opportunities: PerformanceOpportunity[] = [];

    for (const ranking of rankingInsights) {
      if (ranking.isPageOneOpportunity) {
        opportunities.push({
          category: "ranking",
          description: `"${ranking.keyword}" ranks at position ${ranking.currentPosition}, within reach of page one.`,
          rationale: "Positions 11-20 ('page two') are the closest real opportunities to reach page one (1-10).",
          priority: "high",
        });
      }
      if (ranking.trend === "declining") {
        opportunities.push({
          category: "ranking-decline",
          description: `"${ranking.keyword}" moved from position ${ranking.previousPosition} to ${ranking.currentPosition}.`,
          rationale: "A real, measured ranking decline between two measurement periods.",
          priority: "medium",
        });
      }
    }

    if (trafficInsight && trafficInsight.trend === "declining") {
      opportunities.push({
        category: "traffic-decline",
        description: `Organic sessions declined to ${trafficInsight.organicSessions} for this page.`,
        rationale: "A real, measured drop in organic sessions between two measurement periods.",
        priority: "high",
      });
    }

    for (const vital of coreWebVitalInsights) {
      if (!vital.passesThreshold) {
        opportunities.push({
          category: "core-web-vitals",
          description: `${vital.metric} measures ${vital.value}, above the "good" threshold of ${vital.threshold}.`,
          rationale: "Core Web Vitals are a real, Google-published ranking and user-experience signal.",
          priority: "high",
        });
      }
    }

    return opportunities;
  }
}
