import { describe, expect, it } from "vitest";
import { AdministrativeRecordBuilder } from "../../../../src/agents/admin-agent/organizing/administrative-record-builder.js";
import type { ClientStatusEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { GrowthOpportunity, QualifiedLeadReportEntry } from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";

function makeClient(overrides: Partial<ClientStatusEntry> = {}): ClientStatusEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeLead(overrides: Partial<QualifiedLeadReportEntry> = {}): QualifiedLeadReportEntry {
  return { domain: "example.com", stage: "negotiating", qualification: "qualified", notes: "x", ...overrides };
}

function makeOpportunity(overrides: Partial<GrowthOpportunity> = {}): GrowthOpportunity {
  return { category: "reactivation", description: "Reconsider outreach.", rationale: "Real signal.", ...overrides };
}

describe("AdministrativeRecordBuilder", () => {
  const builder = new AdministrativeRecordBuilder();

  it("returns no records when there is no real data", () => {
    expect(builder.build([], [], [])).toEqual([]);
  });

  it("builds a client record for every real client status entry", () => {
    const records = builder.build([makeClient()], [], []);
    expect(records).toEqual([{ recordType: "client", identifier: "Acme Plumbing", summary: "active retainer (active)" }]);
  });

  it("builds a prospect record only for qualified leads", () => {
    const records = builder.build(
      [],
      [makeLead({ domain: "a.com", qualification: "qualified" }), makeLead({ domain: "b.com", qualification: "early-stage" })],
      [],
    );
    expect(records).toEqual([{ recordType: "prospect", identifier: "a.com", summary: "negotiating - qualified" }]);
  });

  it("builds a business-opportunity record for every real growth opportunity", () => {
    const records = builder.build([], [], [makeOpportunity({ category: "market", description: "Real market signal." })]);
    expect(records).toEqual([{ recordType: "business-opportunity", identifier: "market", summary: "Real market signal." }]);
  });

  it("combines all three record types when all real data is present", () => {
    const records = builder.build([makeClient()], [makeLead()], [makeOpportunity()]);
    expect(records.map((r) => r.recordType)).toEqual(["client", "prospect", "business-opportunity"]);
  });
});
