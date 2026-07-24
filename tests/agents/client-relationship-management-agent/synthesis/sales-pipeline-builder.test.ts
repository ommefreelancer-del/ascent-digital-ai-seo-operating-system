import { describe, expect, it } from "vitest";
import { SalesPipelineBuilder } from "../../../../src/agents/client-relationship-management-agent/synthesis/sales-pipeline-builder.js";
import type { PublisherRecord } from "../../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

function makeRecord(overrides: Partial<PublisherRecord> = {}): PublisherRecord {
  return {
    domain: "example.com",
    title: "Example Blog",
    category: "guest-post",
    qualification: "approved",
    outreachStatus: "drafted",
    negotiationStatus: "negotiating",
    notes: "Real note.",
    ...overrides,
  };
}

describe("SalesPipelineBuilder", () => {
  const builder = new SalesPipelineBuilder();

  it("returns an empty report for no real publisher records or placements", () => {
    expect(builder.build([], [])).toEqual({ pipelineEntries: [], wonDeals: [], lostDeals: [] });
  });

  it("maps awaiting-reply to contacted", () => {
    const report = builder.build([makeRecord({ negotiationStatus: "awaiting-reply" })], []);
    expect(report.pipelineEntries).toEqual([{ domain: "example.com", stage: "contacted", notes: "Real note." }]);
  });

  it("maps negotiating to negotiation", () => {
    const report = builder.build([makeRecord({ negotiationStatus: "negotiating" })], []);
    expect(report.pipelineEntries[0]?.stage).toBe("negotiation");
  });

  it("maps agreed-pending-confirmation to awaiting-approval", () => {
    const report = builder.build([makeRecord({ negotiationStatus: "agreed-pending-confirmation" })], []);
    expect(report.pipelineEntries[0]?.stage).toBe("awaiting-approval");
  });

  it("excludes a record with no real negotiation status from the pipeline", () => {
    const report = builder.build([makeRecord({ negotiationStatus: null })], []);
    expect(report.pipelineEntries).toEqual([]);
  });

  it("excludes agreed-confirmed and rejected-over-budget from the active pipeline", () => {
    const report = builder.build(
      [makeRecord({ domain: "a.com", negotiationStatus: "agreed-confirmed" }), makeRecord({ domain: "b.com", negotiationStatus: "rejected-over-budget" })],
      [],
    );
    expect(report.pipelineEntries).toEqual([]);
  });

  it("reuses real confirmed placements directly as won deals", () => {
    const report = builder.build([], [{ domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }]);
    expect(report.wonDeals).toEqual([{ domain: "a.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }]);
  });

  it("flags a real rejected-over-budget record as a lost deal", () => {
    const report = builder.build([makeRecord({ domain: "b.com", negotiationStatus: "rejected-over-budget", notes: "Over budget." })], []);
    expect(report.lostDeals).toEqual([{ domain: "b.com", reason: "Over budget." }]);
  });
});
