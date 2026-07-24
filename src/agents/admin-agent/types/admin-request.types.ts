// Input/output shapes for the Admin Agent, per Agents/admin-agent.md. This
// agent introduces no new pluggable provider: it consumes the real,
// already-computed AiCrmResult and BusinessDevelopmentResult directly (per
// its own "Receives: ... AI CRM Agent, Business Development Agent"), plus
// real, caller-supplied internal documents, project updates, and team
// requests -- it never fetches or infers anything itself. This agent never
// deletes a record; per its own rule "never delete critical records without
// approval", any real caller-supplied text describing a deletion/removal is
// escalated to a human rather than silently organized (see
// validation/admin-request-validator.ts).

import type { AiCrmResult } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { BusinessDevelopmentResult } from "../../business-development-agent/types/business-development-request.types.js";

export type DocumentCategory = "sop" | "contract" | "onboarding" | "compliance" | "general";

/** A real, caller-supplied internal document. Never invented. */
export interface InternalDocumentEntry {
  readonly name: string;
  readonly category: DocumentCategory;
  readonly lastUpdatedAt: string;
}

export type ProjectStatus = "not-started" | "in-progress" | "completed" | "archived";

/** A real, caller-supplied project status update. Never invented. */
export interface ProjectUpdateEntry {
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly note: string;
}

/** A real, caller-supplied request from a team member. Never invented. */
export interface TeamRequestEntry {
  readonly requestedBy: string;
  readonly description: string;
}

export interface AdminRequest {
  readonly id: string;
  readonly crmData: AiCrmResult;
  readonly businessDevelopment: BusinessDevelopmentResult;
  readonly businessRequirements?: string;
  readonly internalDocuments?: readonly InternalDocumentEntry[];
  readonly projectUpdates?: readonly ProjectUpdateEntry[];
  readonly teamRequests?: readonly TeamRequestEntry[];
}

export interface OrganizedDocumentEntry {
  readonly name: string;
  readonly category: DocumentCategory;
  readonly lastUpdatedAt: string;
}

export interface SopReviewFlag {
  readonly name: string;
  readonly lastUpdatedAt: string;
  readonly note: string;
}

export interface ProjectStatusReportEntry {
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly note: string;
}

export type AdministrativeRecordType = "client" | "prospect" | "business-opportunity";

export interface AdministrativeRecordEntry {
  readonly recordType: AdministrativeRecordType;
  readonly identifier: string;
  readonly summary: string;
}

export type ComplianceStatus = "met" | "unmet";

export interface ComplianceChecklistItem {
  readonly item: string;
  readonly status: ComplianceStatus;
  readonly note: string;
}

export interface AdminResult {
  readonly requestId: string;
  /** True when real CRM or business development activity exists to report on. */
  readonly dataAvailable: boolean;
  readonly organizedDocumentation: readonly OrganizedDocumentEntry[];
  readonly sopReviewFlags: readonly SopReviewFlag[];
  readonly projectStatusReport: readonly ProjectStatusReportEntry[];
  readonly administrativeRecords: readonly AdministrativeRecordEntry[];
  readonly complianceChecklist: readonly ComplianceChecklistItem[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
