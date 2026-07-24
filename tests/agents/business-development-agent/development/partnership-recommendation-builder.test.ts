import { describe, expect, it } from "vitest";
import { PartnershipRecommendationBuilder } from "../../../../src/agents/business-development-agent/development/partnership-recommendation-builder.js";
import type { QualifiedLeadReportEntry } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeLead(overrides: Partial<QualifiedLeadReportEntry> = {}): QualifiedLeadReportEntry {
  return { domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "x", ...overrides };
}

describe("PartnershipRecommendationBuilder", () => {
  const builder = new PartnershipRecommendationBuilder();

  it("returns no recommendations when no lead has reached agreed-confirmed", () => {
    const report = [makeLead({ stage: "negotiating" }), makeLead({ domain: "b.com", stage: "awaiting-reply" })];
    expect(builder.build(report)).toEqual([]);
  });

  it("recommends a partnership only for a real confirmed agreement", () => {
    const report = [
      makeLead({ domain: "a.com", stage: "negotiating" }),
      makeLead({ domain: "b.com", stage: "agreed-confirmed" }),
    ];

    const recommendations = builder.build(report);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.domain).toBe("b.com");
    expect(recommendations[0]?.recommendation).toContain("b.com");
  });

  it("recommends a partnership for every real confirmed agreement", () => {
    const report = [makeLead({ domain: "a.com", stage: "agreed-confirmed" }), makeLead({ domain: "b.com", stage: "agreed-confirmed" })];
    expect(builder.build(report)).toHaveLength(2);
  });
});
