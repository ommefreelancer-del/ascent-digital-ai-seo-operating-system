// Builds a TrafficInsight from a real TrafficSnapshot. Returns `null` when
// no traffic snapshot was supplied -- never a fabricated session count.

import type { TrafficSnapshot } from "../types/performance-data-provider.types.js";
import type { PerformanceTrend, TrafficInsight } from "../types/performance-analytics-request.types.js";

function trendFor(organicSessions: number, previousOrganicSessions: number | null): PerformanceTrend {
  if (previousOrganicSessions === null) {
    return "unknown";
  }
  if (organicSessions > previousOrganicSessions) {
    return "improving";
  }
  if (organicSessions < previousOrganicSessions) {
    return "declining";
  }
  return "stable";
}

export class TrafficInsightBuilder {
  build(traffic: TrafficSnapshot | null): TrafficInsight | null {
    if (!traffic) {
      return null;
    }
    return {
      organicSessions: traffic.organicSessions,
      trend: trendFor(traffic.organicSessions, traffic.previousOrganicSessions),
      conversions: traffic.conversions,
    };
  }
}
