// Input/output shapes for the Client Relationship Management Agent, per
// Agents/client-relationship-management-agent.md. This agent introduces no
// new pluggable provider and duplicates no existing agent's logic: it
// consumes the real, already-computed AiCrmResult, BusinessDevelopmentResult,
// GoogleSheetsIntegrationResult, and GuestPostingDigitalPrResult directly --
// client status, lead qualification, spreadsheet sync, and per-domain
// negotiation status already have dedicated agents earlier in the pipeline.
// The sales pipeline view reuses the Guest Posting & Digital PR Agent's own
// real, domain-keyed publisher records and confirmed placements rather than
// re-deriving anything from the Reply & Negotiation Agent directly,
// matching this agent's own listed dependency on that agent. Financial
// records (quotations, contracts, invoices) are the one genuinely new
// domain this agent introduces -- always real, caller-supplied, never
// invented, and this agent never sends/signs/approves any of them itself.

import type { ClientStatusEntry } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../business-development-agent/types/business-development-request.types.js";
import type { GoogleSheetsIntegrationResult } from "../../google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { AiCrmResult } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { ConfirmedPlacement, GuestPostingDigitalPrResult } from "../../guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";

export type QuotationStatus = "draft" | "sent" | "approved" | "declined";

/** A real, caller-supplied quotation record. Never invented. */
export interface QuotationEntry {
  readonly clientName: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: QuotationStatus;
  readonly issuedAt: string;
}

export type ContractStatus = "draft" | "sent" | "signed";

/** A real, caller-supplied contract record. Never invented. */
export interface ContractEntry {
  readonly clientName: string;
  readonly status: ContractStatus;
  readonly effectiveDate: string;
}

export type InvoiceStatus = "issued" | "paid" | "overdue";

/** A real, caller-supplied invoice record. Never invented. */
export interface InvoiceEntry {
  readonly clientName: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: InvoiceStatus;
  readonly dueDate: string;
}

export interface ClientRelationshipManagementRequest {
  readonly id: string;
  readonly crmData: AiCrmResult;
  readonly businessDevelopment: BusinessDevelopmentResult;
  readonly googleSheets: GoogleSheetsIntegrationResult;
  readonly guestPostingDigitalPr: GuestPostingDigitalPrResult;
  readonly quotations?: readonly QuotationEntry[];
  readonly contracts?: readonly ContractEntry[];
  readonly invoices?: readonly InvoiceEntry[];
}

/**
 * Only stages this build has real, direct evidence for, via the Guest
 * Posting & Digital PR Agent's own real, per-domain negotiation status.
 * "Discovery Scheduled", "Proposal Sent", "Contract Signed", "Project
 * Active", "Project Completed", and "Long-Term Client" are deliberately
 * absent -- this build has no real data source (discovery meeting records,
 * proposal delivery receipts, signed contract documents, project
 * management data) to justify those determinations, matching the precedent
 * set by CampaignPhase deliberately omitting "completed".
 */
export type ClientPipelineStage = "contacted" | "negotiation" | "awaiting-approval";

export interface SalesPipelineEntry {
  readonly domain: string;
  readonly stage: ClientPipelineStage;
  readonly notes: string;
}

export interface LostDeal {
  readonly domain: string;
  readonly reason: string;
}

export interface SalesPipelineReport {
  readonly pipelineEntries: readonly SalesPipelineEntry[];
  /** Reuses the Guest Posting & Digital PR Agent's own real confirmed placements -- never re-derived. */
  readonly wonDeals: readonly ConfirmedPlacement[];
  readonly lostDeals: readonly LostDeal[];
}

export interface FinancialSummary {
  readonly totalQuotedAmount: number;
  readonly approvedQuotationCount: number;
  readonly signedContractCount: number;
  readonly outstandingInvoiceCount: number;
  readonly overdueInvoices: readonly InvoiceEntry[];
}

export interface ProjectCoordinationReport {
  readonly campaignName: string;
  readonly phase: string;
  readonly draftedCount: number;
  readonly skippedCount: number;
  readonly confirmedPlacementCount: number;
  /** Mirrors googleSheets.dataAvailable. */
  readonly sheetSyncDataAvailable: boolean;
  readonly sheetProposedUpdateCount: number;
}

export interface ClientRelationshipReport {
  readonly totalClients: number;
  readonly activeClients: number;
  readonly inactiveClients: number;
  readonly pipelineCount: number;
  readonly wonDealCount: number;
  readonly lostDealCount: number;
  readonly outstandingInvoiceCount: number;
}

export interface ClientRelationshipManagementResult {
  readonly requestId: string;
  /** True when real activity exists in any consumed upstream result. */
  readonly dataAvailable: boolean;
  readonly clientProfiles: readonly ClientStatusEntry[];
  readonly salesPipelineReport: SalesPipelineReport;
  readonly financialSummary: FinancialSummary;
  readonly projectCoordinationReport: ProjectCoordinationReport;
  readonly clientRelationshipReport: ClientRelationshipReport;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
