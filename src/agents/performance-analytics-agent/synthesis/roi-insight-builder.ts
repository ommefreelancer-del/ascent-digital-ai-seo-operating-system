// Builds a RoiInsight from real, measured conversions and a real average
// conversion value. Both figures must be genuinely present -- if either is
// unavailable, this returns `null` rather than estimating from a guess or
// an industry-average figure. estimatedRevenue is plain arithmetic over
// real inputs (conversions x averageConversionValue), never an invented
// multiplier.

import type { TrafficSnapshot } from "../types/performance-data-provider.types.js";
import type { RoiInsight } from "../types/performance-analytics-request.types.js";

export class RoiInsightBuilder {
  build(traffic: TrafficSnapshot | null): RoiInsight | null {
    if (!traffic || traffic.conversions === null || traffic.averageConversionValue === null) {
      return null;
    }
    const { conversions, averageConversionValue } = traffic;
    return {
      conversions,
      averageConversionValue,
      estimatedRevenue: conversions * averageConversionValue,
      basis:
        `Computed from ${conversions} measured conversion(s) x $${averageConversionValue} average conversion ` +
        "value -- both real, supplied figures. This is not a prediction of future revenue.",
    };
  }
}
