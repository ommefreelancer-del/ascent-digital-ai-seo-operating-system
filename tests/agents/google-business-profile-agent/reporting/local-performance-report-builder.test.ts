import { describe, expect, it } from "vitest";
import { LocalPerformanceReportBuilder } from "../../../../src/agents/google-business-profile-agent/reporting/local-performance-report-builder.js";

describe("LocalPerformanceReportBuilder", () => {
  const builder = new LocalPerformanceReportBuilder();

  it("returns null fields and trend unknown when there is no real snapshot", () => {
    expect(builder.build(null)).toEqual({ searchViews: null, mapViews: null, callClicks: null, directionRequests: null, trend: "unknown" });
  });

  it("passes through real figures and marks trend unknown with no prior period", () => {
    const report = builder.build({ searchViews: 500, mapViews: 200, callClicks: 30, directionRequests: 20, previousSearchViews: null });
    expect(report).toMatchObject({ searchViews: 500, mapViews: 200, callClicks: 30, directionRequests: 20, trend: "unknown" });
  });

  it("marks trend improving when real search views increased", () => {
    const report = builder.build({ searchViews: 600, mapViews: 200, callClicks: 30, directionRequests: 20, previousSearchViews: 500 });
    expect(report.trend).toBe("improving");
  });

  it("marks trend declining when real search views decreased", () => {
    const report = builder.build({ searchViews: 400, mapViews: 200, callClicks: 30, directionRequests: 20, previousSearchViews: 500 });
    expect(report.trend).toBe("declining");
  });

  it("marks trend stable when real search views are unchanged", () => {
    const report = builder.build({ searchViews: 500, mapViews: 200, callClicks: 30, directionRequests: 20, previousSearchViews: 500 });
    expect(report.trend).toBe("stable");
  });
});
