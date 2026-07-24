import { describe, expect, it } from "vitest";
import { NullPerformanceDataProvider } from "../../../../src/agents/performance-analytics-agent/providers/null-performance-data-provider.js";

describe("NullPerformanceDataProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullPerformanceDataProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated value", async () => {
    const provider = new NullPerformanceDataProvider();
    const result = await provider.fetchPerformanceData({ url: "https://oursite.com/plumbing", keywords: ["plumber"] });
    expect(result).toBeNull();
  });
});
