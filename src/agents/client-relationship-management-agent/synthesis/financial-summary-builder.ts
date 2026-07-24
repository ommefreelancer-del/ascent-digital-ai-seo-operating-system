// Builds a real financial summary -- per the spec's "Track quotations,
// contracts, and invoices" responsibility. Plain aggregation over real,
// caller-supplied financial records; this agent never invents an amount or
// re-derives an "overdue" determination the caller did not already report.

import type { ContractEntry, FinancialSummary, InvoiceEntry, QuotationEntry } from "../types/client-relationship-management-request.types.js";

export class FinancialSummaryBuilder {
  build(
    quotations: readonly QuotationEntry[],
    contracts: readonly ContractEntry[],
    invoices: readonly InvoiceEntry[],
  ): FinancialSummary {
    return {
      totalQuotedAmount: quotations.reduce((sum, quotation) => sum + quotation.amount, 0),
      approvedQuotationCount: quotations.filter((quotation) => quotation.status === "approved").length,
      signedContractCount: contracts.filter((contract) => contract.status === "signed").length,
      outstandingInvoiceCount: invoices.filter((invoice) => invoice.status !== "paid").length,
      overdueInvoices: invoices.filter((invoice) => invoice.status === "overdue"),
    };
  }
}
