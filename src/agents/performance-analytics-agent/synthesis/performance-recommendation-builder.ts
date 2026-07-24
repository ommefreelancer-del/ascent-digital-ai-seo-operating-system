// Recommends optimization priorities from real, measured performance
// insights -- per the spec's "Recommend optimization priorities" and "Track
// the impact of implemented SEO recommendations" responsibilities. Every
// recommendation traces to a real insight already computed from real data;
// this builder produces zero recommendations when no insights exist, rather
// than filling the gap with generic advice.

import type {
  CoreWebVitalInsight,
  PerformanceRecommendation,
  RankingInsight,
  RoiInsight,
  TrafficInsight,
} from "../types/performance-analytics-request.types.js";

const CORE_WEB_VITAL_GUIDANCE: Record<CoreWebVitalInsight["metric"], string> = {
  LCP: "reducing render-blocking resources, optimizing the largest above-the-fold image or text block, and using a faster hosting/CDN setup",
  INP: "minimizing long JavaScript tasks and reducing input handler work on the page's main interactions",
  CLS: "reserving layout space for images, ads, and embeds so content does not shift after it loads",
};

export class PerformanceRecommendationBuilder {
  build(
    rankingInsights: readonly RankingInsight[],
    trafficInsight: TrafficInsight | null,
    coreWebVitalInsights: readonly CoreWebVitalInsight[],
    roiInsight: RoiInsight | null,
  ): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];

    for (const ranking of rankingInsights) {
      if (ranking.isPageOneOpportunity) {
        recommendations.push({
          category: "ranking",
          priority: "high",
          recommendation:
            `Prioritize on-page and content improvements for "${ranking.keyword}" to close the gap from ` +
            `position ${ranking.currentPosition} into the top 10.`,
          rationale: `Real, measured position: ${ranking.currentPosition}.`,
        });
      }
      if (ranking.trend === "declining") {
        recommendations.push({
          category: "ranking-decline",
          priority: "medium",
          recommendation:
            `Investigate why "${ranking.keyword}" moved from position ${ranking.previousPosition} to ` +
            `${ranking.currentPosition}; correlate with recent technical, content, or competitive changes.`,
          rationale: `Real, measured decline from position ${ranking.previousPosition} to ${ranking.currentPosition}.`,
        });
      }
    }

    if (trafficInsight && trafficInsight.trend === "declining") {
      recommendations.push({
        category: "traffic-decline",
        priority: "high",
        recommendation:
          "Investigate the organic traffic decline; correlate with the ranking and technical findings for this page.",
        rationale: `Real, measured organic sessions: ${trafficInsight.organicSessions} (declining).`,
      });
    }

    for (const vital of coreWebVitalInsights) {
      if (!vital.passesThreshold) {
        recommendations.push({
          category: "core-web-vitals",
          priority: "high",
          recommendation: `Improve ${vital.metric} by ${CORE_WEB_VITAL_GUIDANCE[vital.metric]}.`,
          rationale: `Real, measured ${vital.metric}: ${vital.value} (Google's "good" threshold is ${vital.threshold}).`,
        });
      }
    }

    if (roiInsight) {
      recommendations.push({
        category: "roi",
        priority: "medium",
        recommendation:
          `Weigh further optimization investment for this page against its estimated $${roiInsight.estimatedRevenue} ` +
          "in attributable revenue.",
        rationale: roiInsight.basis,
      });
    }

    return recommendations;
  }
}
