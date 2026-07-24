import { describe, expect, it } from "vitest";
import { ClientRelationshipReportBuilder } from "../../../../src/agents/client-relationship-management-agent/synthesis/client-relationship-report-builder.js";
import type { ClientStatusEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { SalesPipelineReport, FinancialSummary } from "../../../../src/agents/client-relationship-management-agent/types/client-relationship-management-request.types.js";

const EMPTY_PIPELINE: SalesPipelineReport = { pipelineEntries: [], wonDeals: [], lostDeals: [] };
const EMPTY_FINANCIALS: FinancialSummary = { totalQuotedAmount: 0, approvedQuotationCount: 0, signedContractCount: 0, outstandingInvoiceCount: 0, overdueInvoices: [] };

describe("ClientRelationshipReportBuilder", () => {
  const builder = new ClientRelationshipReportBuilder();

  it("returns all-zero counts for no real data", () => {
    expect(builder.build([], EMPTY_PIPELINE, EMPTY_FINANCIALS)).toEqual({
      totalClients: 0,
      activeClients: 0,
      inactiveClients: 0,
      pipelineCount: 0,
      wonDealCount: 0,
      lostDealCount: 0,
      outstandingInvoiceCount: 0,
    });
  });

  it("counts real active and inactive clients separately", () => {
    const clientProfiles: ClientStatusEntry[] = [
      { clientName: "A", status: "active retainer", activity: "active", lastContactedAt: "2026-07-01T00:00:00.000Z" },
      { clientName: "B", status: "dormant", activity: "inactive", lastContactedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const report = builder.build(clientProfiles, EMPTY_PIPELINE, EMPTY_FINANCIALS);
    expect(report.totalClients).toBe(2);
    expect(report.activeClients).toBe(1);
    expect(report.inactiveClients).toBe(1);
  });

  it("counts real pipeline, won, and lost deals from the sales pipeline report", () => {
    const pipeline: SalesPipelineReport = {
      pipelineEntries: [{ domain: "a.com", stage: "negotiation", notes: "x" }],
      wonDeals: [{ domain: "b.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }],
      lostDeals: [{ domain: "c.com", reason: "Over budget." }],
    };
    const report = builder.build([], pipeline, EMPTY_FINANCIALS);
    expect(report.pipelineCount).toBe(1);
    expect(report.wonDealCount).toBe(1);
    expect(report.lostDealCount).toBe(1);
  });

  it("carries forward the real outstanding invoice count from the financial summary", () => {
    const report = builder.build([], EMPTY_PIPELINE, { ...EMPTY_FINANCIALS, outstandingInvoiceCount: 4 });
    expect(report.outstandingInvoiceCount).toBe(4);
  });
});
