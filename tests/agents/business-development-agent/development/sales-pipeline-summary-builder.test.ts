import { describe, expect, it } from "vitest";
import { SalesPipelineSummaryBuilder } from "../../../../src/agents/business-development-agent/development/sales-pipeline-summary-builder.js";
import type { QualifiedLeadReportEntry } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeEntry(overrides: Partial<QualifiedLeadReportEntry> = {}): QualifiedLeadReportEntry {
  return { domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "x", ...overrides };
}

describe("SalesPipelineSummaryBuilder", () => {
  const builder = new SalesPipelineSummaryBuilder();

  it("returns all-zero counts for an empty report", () => {
    expect(builder.build([])).toEqual({ totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 });
  });

  it("counts each qualification tier from real, already-qualified entries", () => {
    const summary = builder.build([
      makeEntry({ qualification: "qualified" }),
      makeEntry({ qualification: "qualified" }),
      makeEntry({ qualification: "early-stage" }),
      makeEntry({ qualification: "not-qualified" }),
    ]);

    expect(summary).toEqual({ totalLeads: 4, qualifiedCount: 2, earlyStageCount: 1, notQualifiedCount: 1 });
  });
});
