// Builds a RankingInsight for every keyword with a real, measured current
// position. Keywords with no current position (not ranking in the tracked
// results, or genuinely unmeasured) are excluded here -- there is nothing
// real to report a position for -- and are instead surfaced as a limitation
// by the facade, never silently dropped without a trace.

import type { KeywordRankingSnapshot } from "../types/performance-data-provider.types.js";
import type { PerformanceTrend, RankingInsight } from "../types/performance-analytics-request.types.js";

const PAGE_ONE_OPPORTUNITY_MIN_POSITION = 11;
const PAGE_ONE_OPPORTUNITY_MAX_POSITION = 20;

function trendFor(currentPosition: number, previousPosition: number | null): PerformanceTrend {
  if (previousPosition === null) {
    return "unknown";
  }
  // Lower position number is a better rank, so a decreasing number is "improving".
  if (currentPosition < previousPosition) {
    return "improving";
  }
  if (currentPosition > previousPosition) {
    return "declining";
  }
  return "stable";
}

export class RankingInsightBuilder {
  build(rankings: readonly KeywordRankingSnapshot[]): RankingInsight[] {
    return rankings
      .filter((ranking): ranking is KeywordRankingSnapshot & { position: number } => ranking.position !== null)
      .map((ranking) => ({
        keyword: ranking.keyword,
        currentPosition: ranking.position,
        previousPosition: ranking.previousPosition,
        trend: trendFor(ranking.position, ranking.previousPosition),
        isPageOneOpportunity:
          ranking.position >= PAGE_ONE_OPPORTUNITY_MIN_POSITION && ranking.position <= PAGE_ONE_OPPORTUNITY_MAX_POSITION,
      }));
  }
}
