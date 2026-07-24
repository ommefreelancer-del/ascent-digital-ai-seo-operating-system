// Input/output shapes for the Publisher Qualification Agent, per
// Agents/publisher-qualification-agent.md. This agent evaluates only -- it
// never contacts a publisher (that is the Contact Intelligence/Outreach
// Agents' job, later in the pipeline). Every qualification decision traces
// to real evidence: niche relevance is checked deterministically against
// the real prospect data already produced by the Prospecting Agent, and
// quality (domain authority, spam score) comes only from the injected
// PublisherQualityProvider. Per this agent's own rule "forward only
// qualified prospects", a prospect with no real quality evidence behind it
// is rejected, not assumed acceptable -- see qualification/prospect-qualifier.ts.

import type { ProspectingResult } from "../../prospecting-agent/types/prospecting-request.types.js";

export interface PublisherQualificationRequest {
  readonly id: string;
  readonly prospecting: ProspectingResult;
  readonly campaignRequirements: string;
  readonly targetNiche: string;
  readonly userInstructions?: string;
}

export type QualificationDecision = "approved" | "rejected";

export interface QualifiedProspect {
  readonly url: string;
  readonly domain: string;
  readonly title: string;
  readonly decision: QualificationDecision;
  readonly notes: string;
}

export interface PublisherQualificationResult {
  readonly requestId: string;
  /** True only when real quality evidence was obtained for at least one prospect. */
  readonly dataAvailable: boolean;
  readonly approvedProspects: readonly QualifiedProspect[];
  readonly rejectedProspects: readonly QualifiedProspect[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
