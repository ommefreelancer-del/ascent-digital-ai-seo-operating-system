import { describe, expect, it } from "vitest";
import { FinancialSummaryBuilder } from "../../../../src/agents/client-relationship-management-agent/synthesis/financial-summary-builder.js";
import type {
  ContractEntry,
  InvoiceEntry,
  QuotationEntry,
} from "../../../../src/agents/client-relationship-management-agent/types/client-relationship-management-request.types.js";

function makeQuotation(overrides: Partial<QuotationEntry> = {}): QuotationEntry {
  return { clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "sent", issuedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeContract(overrides: Partial<ContractEntry> = {}): ContractEntry {
  return { clientName: "Acme Plumbing", status: "signed", effectiveDate: "2026-07-01T00:00:00.000Z", ...overrides };
}

function makeInvoice(overrides: Partial<InvoiceEntry> = {}): InvoiceEntry {
  return { clientName: "Acme Plumbing", amount: 500, currency: "USD", status: "issued", dueDate: "2026-08-01T00:00:00.000Z", ...overrides };
}

describe("FinancialSummaryBuilder", () => {
  const builder = new FinancialSummaryBuilder();

  it("returns all-zero counts for no real financial records", () => {
    expect(builder.build([], [], [])).toEqual({
      totalQuotedAmount: 0,
      approvedQuotationCount: 0,
      signedContractCount: 0,
      outstandingInvoiceCount: 0,
      overdueInvoices: [],
    });
  });

  it("sums real quoted amounts across every quotation", () => {
    const summary = builder.build([makeQuotation({ amount: 500 }), makeQuotation({ amount: 300 })], [], []);
    expect(summary.totalQuotedAmount).toBe(800);
  });

  it("counts only real approved quotations", () => {
    const summary = builder.build([makeQuotation({ status: "approved" }), makeQuotation({ status: "sent" })], [], []);
    expect(summary.approvedQuotationCount).toBe(1);
  });

  it("counts only real signed contracts", () => {
    const summary = builder.build([], [makeContract({ status: "signed" }), makeContract({ status: "draft" })], []);
    expect(summary.signedContractCount).toBe(1);
  });

  it("counts every real invoice that is not paid as outstanding", () => {
    const summary = builder.build([], [], [makeInvoice({ status: "issued" }), makeInvoice({ status: "overdue" }), makeInvoice({ status: "paid" })]);
    expect(summary.outstandingInvoiceCount).toBe(2);
  });

  it("flags only real invoices the caller marked overdue, never re-deriving from the due date", () => {
    const overdueInvoice = makeInvoice({ status: "overdue" });
    const summary = builder.build([], [], [overdueInvoice, makeInvoice({ status: "issued" })]);
    expect(summary.overdueInvoices).toEqual([overdueInvoice]);
  });
});
