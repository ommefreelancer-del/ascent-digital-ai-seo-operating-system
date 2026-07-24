// Input/output shapes for the Google Sheets Integration Agent, per
// Agents/google-sheets-integration-agent.md. This agent consumes the real,
// already-computed AiCrmResult, OutreachResult, CampaignTrackingResult, and
// ReplyNegotiationResult directly -- it never fetches or infers business
// data itself. The only real external read this agent performs is through
// the injected GoogleSheetsProvider (see types/google-sheets-provider.types.ts),
// used solely to determine which client/publisher rows already exist (to
// avoid proposing a duplicate) and to detect duplicates already present in
// the real sheet. Per this agent's own rule "never overwrite existing data
// without validation", this agent never writes to a real Google Sheet
// itself, in this build or any future one -- it only proposes updates for a
// human to authorize and apply via the real Google Sheets/Drive API.

import type { AiCrmResult } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { SheetRecordType } from "./google-sheets-provider.types.js";

export interface GoogleSheetsIntegrationRequest {
  readonly id: string;
  readonly spreadsheetId: string;
  readonly crmData: AiCrmResult;
  readonly outreach: OutreachResult;
  readonly campaignTracking: CampaignTrackingResult;
  readonly replyNegotiation: ReplyNegotiationResult;
  /** Optional real, caller-supplied instructions (e.g. "add the new client to the sheet"). Never invented. */
  readonly userInstructions?: string;
}

export type SheetRecordCategory = "client" | "publisher" | "pricing" | "outreach-status" | "deal-status" | "campaign-status";
export type SheetUpdateAction = "create" | "update";

export interface SheetUpdateProposal {
  readonly recordCategory: SheetRecordCategory;
  readonly action: SheetUpdateAction;
  readonly identifier: string;
  readonly summary: string;
  /** Always true in this build: writing to a real Google Sheet requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export interface CrmSyncReportEntry {
  readonly identifier: string;
  readonly summary: string;
}

export interface DataValidationIssue {
  readonly identifier: string;
  readonly issue: string;
}

export interface DuplicateRecordFlag {
  readonly recordType: SheetRecordType;
  readonly identifier: string;
  readonly note: string;
}

export interface SpreadsheetSummary {
  readonly totalProposedUpdates: number;
  readonly clientUpdateCount: number;
  readonly publisherUpdateCount: number;
  readonly pricingUpdateCount: number;
}

export interface GoogleSheetsIntegrationResult {
  readonly requestId: string;
  /** True only when a real GoogleSheetsProvider snapshot was obtained for the requested spreadsheet. */
  readonly dataAvailable: boolean;
  readonly sheetUpdateProposals: readonly SheetUpdateProposal[];
  readonly crmSyncReport: readonly CrmSyncReportEntry[];
  readonly dataValidationReport: readonly DataValidationIssue[];
  readonly duplicateFlags: readonly DuplicateRecordFlag[];
  readonly spreadsheetSummary: SpreadsheetSummary;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
