// Builds a LocalPerformanceReport from a real LocalSearchPerformance
// snapshot. Returns null/"unknown" fields when no snapshot or no prior
// measurement exists -- never a fabricated figure or guessed trend.

import type { LocalSearchPerformance } from "../types/gbp-data-provider.types.js";
import type { LocalPerformanceReport, LocalPerformanceTrend } from "../types/google-business-profile-request.types.js";

function trendFor(searchViews: number, previousSearchViews: number | null): LocalPerformanceTrend {
  if (previousSearchViews === null) {
    return "unknown";
  }
  if (searchViews > previousSearchViews) {
    return "improving";
  }
  if (searchViews < previousSearchViews) {
    return "declining";
  }
  return "stable";
}

export class LocalPerformanceReportBuilder {
  build(localSearchPerformance: LocalSearchPerformance | null): LocalPerformanceReport {
    if (!localSearchPerformance) {
      return { searchViews: null, mapViews: null, callClicks: null, directionRequests: null, trend: "unknown" };
    }
    return {
      searchViews: localSearchPerformance.searchViews,
      mapViews: localSearchPerformance.mapViews,
      callClicks: localSearchPerformance.callClicks,
      directionRequests: localSearchPerformance.directionRequests,
      trend: trendFor(localSearchPerformance.searchViews, localSearchPerformance.previousSearchViews),
    };
  }
}
