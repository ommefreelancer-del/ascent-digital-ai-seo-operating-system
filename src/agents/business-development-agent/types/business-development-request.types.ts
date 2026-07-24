// Input/output shapes for the Business Development Agent, per
// Agents/business-development-agent.md. This agent introduces no new
// pluggable provider: it consumes the real, already-computed AiCrmResult
// directly ("CRM Data" per its own spec Inputs), plus real, caller-supplied
// business goals, market research, and service portfolio -- it never
// fetches or infers anything itself. Lead qualification is a deterministic
// mapping from the real negotiation stage the AI CRM Agent already
// computed (see development/lead-qualifier.ts), never a re-derived or
// fabricated judgment. Client proposals only ever reference real,
// caller-supplied service portfolio items -- this agent never invents a
// service or a price.

import type { AiCrmResult } from "../../ai-crm-agent/types/ai-crm-request.types.js";
import type { NegotiationStatus } from "../../reply-negotiation-agent/types/reply-negotiation-request.types.js";

/** A real, caller-supplied service offering. Never invented. */
export interface ServicePortfolioItem {
  readonly serviceName: string;
  readonly description: string;
  readonly priceRangeLabel: string;
}

export interface BusinessDevelopmentRequest {
  readonly id: string;
  readonly crmData: AiCrmResult;
  readonly businessGoals: string;
  readonly marketResearch?: string;
  readonly servicePortfolio: readonly ServicePortfolioItem[];
}

export type LeadQualification = "qualified" | "early-stage" | "not-qualified";

export interface QualifiedLeadReportEntry {
  readonly domain: string;
  /** Reuses the Reply & Negotiation Agent's own real negotiation status (via the AI CRM Agent) -- never re-derived. */
  readonly stage: NegotiationStatus;
  readonly qualification: LeadQualification;
  readonly notes: string;
}

export interface SalesPipelineSummary {
  readonly totalLeads: number;
  readonly qualifiedCount: number;
  readonly earlyStageCount: number;
  readonly notQualifiedCount: number;
}

export interface ClientProposalDraft {
  readonly domain: string;
  readonly subject: string;
  readonly body: string;
  /** Always true in this build: sending any proposal requires human approval per GLOBAL_RULES.md SS9. */
  readonly requiresApproval: boolean;
}

export type GrowthOpportunityCategory = "reactivation" | "pipeline" | "market";

export interface GrowthOpportunity {
  readonly category: GrowthOpportunityCategory;
  readonly description: string;
  readonly rationale: string;
}

export interface PartnershipRecommendation {
  readonly domain: string;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface BusinessDevelopmentResult {
  readonly requestId: string;
  /** Mirrors crmData.dataAvailable. */
  readonly dataAvailable: boolean;
  readonly qualifiedLeadReport: readonly QualifiedLeadReportEntry[];
  readonly salesPipelineSummary: SalesPipelineSummary;
  readonly clientProposals: readonly ClientProposalDraft[];
  readonly growthOpportunities: readonly GrowthOpportunity[];
  readonly partnershipRecommendations: readonly PartnershipRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
