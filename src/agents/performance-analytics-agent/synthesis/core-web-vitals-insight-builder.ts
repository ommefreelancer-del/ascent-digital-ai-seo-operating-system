// Builds a CoreWebVitalInsight for every metric with a real, measured value.
// Thresholds are Google's own published "good" thresholds for Core Web
// Vitals (https://web.dev/articles/defining-core-web-vitals-thresholds) --
// a real, documented industry convention, not a value invented for any
// specific business, consistent with how other agents in this codebase
// state their own stated conventions (e.g. StrategyItemCollector's effort
// categories) rather than fabricating business-specific numbers.

import type { CoreWebVitalsSnapshot } from "../types/performance-data-provider.types.js";
import type { CoreWebVitalInsight, CoreWebVitalMetric } from "../types/performance-analytics-request.types.js";

const LCP_GOOD_THRESHOLD_MS = 2500;
const INP_GOOD_THRESHOLD_MS = 200;
const CLS_GOOD_THRESHOLD = 0.1;

export class CoreWebVitalsInsightBuilder {
  build(coreWebVitals: CoreWebVitalsSnapshot | null): CoreWebVitalInsight[] {
    if (!coreWebVitals) {
      return [];
    }

    const insights: CoreWebVitalInsight[] = [];
    this.pushIfMeasured(insights, "LCP", coreWebVitals.lcpMs, LCP_GOOD_THRESHOLD_MS);
    this.pushIfMeasured(insights, "INP", coreWebVitals.inpMs, INP_GOOD_THRESHOLD_MS);
    this.pushIfMeasured(insights, "CLS", coreWebVitals.cls, CLS_GOOD_THRESHOLD);
    return insights;
  }

  private pushIfMeasured(
    insights: CoreWebVitalInsight[],
    metric: CoreWebVitalMetric,
    value: number | null,
    threshold: number,
  ): void {
    if (value === null) {
      return;
    }
    insights.push({ metric, value, threshold, passesThreshold: value <= threshold });
  }
}
