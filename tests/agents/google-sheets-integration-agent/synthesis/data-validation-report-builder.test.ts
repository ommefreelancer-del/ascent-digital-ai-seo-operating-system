import { describe, expect, it } from "vitest";
import { DataValidationReportBuilder } from "../../../../src/agents/google-sheets-integration-agent/synthesis/data-validation-report-builder.js";
import type { FinalAgreedPrice, NegotiationStatusEntry } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeStatus(overrides: Partial<NegotiationStatusEntry> = {}): NegotiationStatusEntry {
  return { domain: "example.com", status: "agreed-confirmed", notes: "Real note.", ...overrides };
}

function makePrice(overrides: Partial<FinalAgreedPrice> = {}): FinalAgreedPrice {
  return { domain: "example.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z", ...overrides };
}

describe("DataValidationReportBuilder", () => {
  const builder = new DataValidationReportBuilder();

  it("returns no issues when there is no real data", () => {
    expect(builder.build([], [])).toEqual([]);
  });

  it("returns no issues when a confirmed agreement has a matching real price", () => {
    expect(builder.build([makeStatus()], [makePrice()])).toEqual([]);
  });

  it("flags a domain marked agreed-confirmed with no matching real price", () => {
    const issues = builder.build([makeStatus({ domain: "example.com" })], []);
    expect(issues).toEqual([{ identifier: "example.com", issue: "Marked agreed-confirmed but no confirmed price is recorded for this domain." }]);
  });

  it("does not flag a domain not yet agreed-confirmed", () => {
    const issues = builder.build([makeStatus({ status: "negotiating" })], []);
    expect(issues).toEqual([]);
  });

  it("does not flag a confirmed agreement whose price is recorded under a different domain", () => {
    const issues = builder.build([makeStatus({ domain: "a.com" })], [makePrice({ domain: "b.com" })]);
    expect(issues).toEqual([{ identifier: "a.com", issue: expect.stringContaining("no confirmed price") }]);
  });
});
