import { describe, expect, it } from "vitest";
import { SecurityStatusReportBuilder } from "../../../../src/agents/website-management-agent/reporting/security-status-report-builder.js";

describe("SecurityStatusReportBuilder", () => {
  const builder = new SecurityStatusReportBuilder();

  it("reports no-data when no scan was supplied", () => {
    expect(builder.build(null)).toEqual({ status: "no-data", threatsFound: null, lastScannedAt: null });
  });

  it("reports clean when the real scan found zero threats", () => {
    const lastScannedAt = new Date().toISOString();
    const report = builder.build({ threatsFound: 0, lastScannedAt });
    expect(report).toEqual({ status: "clean", threatsFound: 0, lastScannedAt });
  });

  it("reports threats-detected when the real scan found at least one threat", () => {
    const lastScannedAt = new Date().toISOString();
    const report = builder.build({ threatsFound: 3, lastScannedAt });
    expect(report).toEqual({ status: "threats-detected", threatsFound: 3, lastScannedAt });
  });
});
