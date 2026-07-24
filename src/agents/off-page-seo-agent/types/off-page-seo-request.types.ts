// Input/output shapes for the Off-Page SEO Agent, per
// Agents/off-page-seo-agent.md. This agent consumes real upstream SEO
// outputs (CompetitorIntelligenceResult, WebsiteAuditResult) plus whatever
// a BacklinkDataProvider can genuinely supply (domain authority, referring
// domains, toxicity flags). With no provider configured (the default),
// `dataAvailable` is false and every data-dependent field is empty/null --
// this agent never invents a domain authority score, referring-domain
// count, or toxicity flag. Toxic-backlink findings are treated as a
// GLOBAL_RULES.md SS13 escalation signal (see validator.findPolicyRiskSignals)
// before being surfaced, since acting on a wrong toxicity flag by disavowing
// a legitimate link can itself harm the site's authority.

import type { CompetitorIntelligenceResult } from "../../competitor-intelligence-agent/types/competitor-intelligence-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";

export interface OffPageSeoRequest {
  readonly id: string;
  readonly url: string;
  readonly businessObjective: string;
  readonly competitorIntelligence: CompetitorIntelligenceResult;
  readonly websiteAudit: WebsiteAuditResult;
}

/** "unknown" when there is no prior measurement to compare against -- never guessed. */
export type BacklinkTrend = "growing" | "declining" | "stable" | "unknown";

export interface ReferringDomainGrowthInsight {
  readonly totalReferringDomains: number;
  readonly previousTotalReferringDomains: number | null;
  readonly trend: BacklinkTrend;
}

export interface ToxicBacklinkInsight {
  readonly domain: string;
  readonly linkingUrl: string;
  readonly anchorText: string;
}

/** "unknown" when either side's domain authority could not be determined -- never guessed. */
export type AuthorityAssessment = "we_are_ahead" | "we_are_behind" | "comparable" | "unknown";

export interface CompetitorAuthorityGap {
  readonly competitorId: string;
  readonly competitorUrl: string | null;
  readonly ourDomainAuthority: number | null;
  readonly competitorDomainAuthority: number | null;
  readonly assessment: AuthorityAssessment;
}

export type OffPageOpportunityPriority = "high" | "medium" | "low";

export interface OffPageOpportunity {
  readonly category: string;
  readonly description: string;
  readonly rationale: string;
  readonly priority: OffPageOpportunityPriority;
}

export type OffPageRecommendationPriority = "high" | "medium" | "low";

export interface OffPageRecommendation {
  readonly category: string;
  readonly priority: OffPageRecommendationPriority;
  readonly recommendation: string;
  readonly rationale: string;
}

export interface OffPageSeoResult {
  readonly requestId: string;
  readonly url: string;
  /** False when no BacklinkDataProvider supplied real data -- data-dependent fields are then empty/null, never guessed. */
  readonly dataAvailable: boolean;
  readonly referringDomainGrowth: ReferringDomainGrowthInsight | null;
  readonly toxicBacklinks: readonly ToxicBacklinkInsight[];
  readonly competitorAuthorityGaps: readonly CompetitorAuthorityGap[];
  readonly opportunities: readonly OffPageOpportunity[];
  readonly recommendations: readonly OffPageRecommendation[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
