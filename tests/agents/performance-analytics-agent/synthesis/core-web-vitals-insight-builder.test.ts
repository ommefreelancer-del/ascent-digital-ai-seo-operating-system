import { describe, expect, it } from "vitest";
import { CoreWebVitalsInsightBuilder } from "../../../../src/agents/performance-analytics-agent/synthesis/core-web-vitals-insight-builder.js";
import type { CoreWebVitalsSnapshot } from "../../../../src/agents/performance-analytics-agent/types/performance-data-provider.types.js";

describe("CoreWebVitalsInsightBuilder", () => {
  const builder = new CoreWebVitalsInsightBuilder();

  it("returns an empty array when no snapshot was supplied", () => {
    expect(builder.build(null)).toEqual([]);
  });

  it("returns an insight only for measured metrics, skipping nulls", () => {
    const snapshot: CoreWebVitalsSnapshot = { lcpMs: 2000, inpMs: null, cls: null };
    const insights = builder.build(snapshot);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.metric).toBe("LCP");
  });

  it("marks LCP <= 2500ms as passing and above as failing", () => {
    const [passing] = builder.build({ lcpMs: 2500, inpMs: null, cls: null });
    const [failing] = builder.build({ lcpMs: 2501, inpMs: null, cls: null });
    expect(passing?.passesThreshold).toBe(true);
    expect(failing?.passesThreshold).toBe(false);
  });

  it("marks INP <= 200ms as passing and above as failing", () => {
    const [passing] = builder.build({ lcpMs: null, inpMs: 200, cls: null });
    const [failing] = builder.build({ lcpMs: null, inpMs: 201, cls: null });
    expect(passing?.passesThreshold).toBe(true);
    expect(failing?.passesThreshold).toBe(false);
  });

  it("marks CLS <= 0.1 as passing and above as failing", () => {
    const [passing] = builder.build({ lcpMs: null, inpMs: null, cls: 0.1 });
    const [failing] = builder.build({ lcpMs: null, inpMs: null, cls: 0.11 });
    expect(passing?.passesThreshold).toBe(true);
    expect(failing?.passesThreshold).toBe(false);
  });

  it("returns insights for all three metrics when all are measured", () => {
    const insights = builder.build({ lcpMs: 1000, inpMs: 50, cls: 0.05 });
    expect(insights.map((i) => i.metric)).toEqual(["LCP", "INP", "CLS"]);
  });
});
