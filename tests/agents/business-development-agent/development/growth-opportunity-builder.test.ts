import { describe, expect, it } from "vitest";
import { GrowthOpportunityBuilder } from "../../../../src/agents/business-development-agent/development/growth-opportunity-builder.js";
import type { ClientStatusEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { SalesPipelineSummary } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeClient(overrides: Partial<ClientStatusEntry> = {}): ClientStatusEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

const NON_EMPTY_QUALIFIED_SUMMARY: SalesPipelineSummary = { totalLeads: 2, qualifiedCount: 1, earlyStageCount: 1, notQualifiedCount: 0 };
const EMPTY_SUMMARY: SalesPipelineSummary = { totalLeads: 0, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 0 };
const ALL_UNQUALIFIED_SUMMARY: SalesPipelineSummary = { totalLeads: 2, qualifiedCount: 0, earlyStageCount: 0, notQualifiedCount: 2 };

describe("GrowthOpportunityBuilder", () => {
  const builder = new GrowthOpportunityBuilder();

  it("returns no opportunities when there is nothing real to report", () => {
    expect(builder.build([], NON_EMPTY_QUALIFIED_SUMMARY, null)).toEqual([]);
  });

  it("flags a reactivation opportunity for every real inactive client", () => {
    const clients = [makeClient({ activity: "inactive", clientName: "Dormant Co" }), makeClient({ activity: "active" })];
    const opportunities = builder.build(clients, NON_EMPTY_QUALIFIED_SUMMARY, null);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.category).toBe("reactivation");
    expect(opportunities[0]?.description).toContain("Dormant Co");
  });

  it("flags a pipeline opportunity when the lead pipeline is empty", () => {
    const opportunities = builder.build([], EMPTY_SUMMARY, null);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.category).toBe("pipeline");
    expect(opportunities[0]?.description).toContain("No real leads are currently in the sales pipeline.");
  });

  it("flags a pipeline opportunity when no leads are qualified but the pipeline is not empty", () => {
    const opportunities = builder.build([], ALL_UNQUALIFIED_SUMMARY, null);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.category).toBe("pipeline");
    expect(opportunities[0]?.rationale).toContain("2");
  });

  it("does not flag a pipeline opportunity when at least one lead is qualified", () => {
    const opportunities = builder.build([], NON_EMPTY_QUALIFIED_SUMMARY, null);
    expect(opportunities.some((o) => o.category === "pipeline")).toBe(false);
  });

  it("echoes real, caller-supplied market research verbatim when provided", () => {
    const opportunities = builder.build([], NON_EMPTY_QUALIFIED_SUMMARY, "Competitors are expanding into HVAC services.");
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.category).toBe("market");
    expect(opportunities[0]?.description).toBe("Competitors are expanding into HVAC services.");
  });

  it("combines reactivation, pipeline, and market opportunities when all real signals are present", () => {
    const clients = [makeClient({ activity: "inactive" })];
    const opportunities = builder.build(clients, EMPTY_SUMMARY, "Real market signal.");
    expect(opportunities.map((o) => o.category)).toEqual(["reactivation", "pipeline", "market"]);
  });
});
