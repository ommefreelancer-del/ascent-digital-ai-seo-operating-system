// Input/output shapes for the SEO Strategy Agent, per
// Agents/SEO Strategy Agent.md. This agent does not re-analyze anything --
// it synthesizes the already-computed, real recommendations from the
// Technical SEO, On-Page SEO, Content Strategy, and Competitor Intelligence
// Agents into a prioritized strategy, matrix, roadmap, and implementation
// plan. Nothing about impact/effort/priority is a fabricated metric: impact
// is the source agent's own already-assigned priority (or, for content
// gaps, the real cluster size); effort is a stated, general
// category-based convention (documented in strategy-item-collector.ts),
// consistent with how other agents state their own conventions rather than
// inventing business-specific numbers.
//
// Performance Analytics (real traffic, rankings, conversions) is explicitly
// out of scope, since this build calls no external analytics API -- see the
// standing limitation the facade always includes.

import type { KeywordResearchResult } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { ContentStrategyResult } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import type { WebsiteAuditResult } from "../../website-audit-agent/types/website-audit-request.types.js";
import type { OnPageSeoResult } from "../../on-page-seo-agent/types/on-page-seo-request.types.js";
import type { TechnicalSeoResult } from "../../technical-seo-agent/types/technical-seo-request.types.js";
import type { CompetitorIntelligenceResult } from "../../competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

export interface SeoStrategyRequest {
  readonly id: string;
  readonly businessObjective: string;
  readonly keywordResearch: KeywordResearchResult;
  readonly websiteAudit: WebsiteAuditResult;
  readonly technicalSeo: TechnicalSeoResult;
  readonly competitorIntelligence: CompetitorIntelligenceResult;
  /** Optional: reflected in the strategy if supplied, otherwise its absence is stated as a limitation. */
  readonly contentStrategy?: ContentStrategyResult;
  /** Optional: reflected in the strategy if supplied, otherwise its absence is stated as a limitation. */
  readonly onPageSeo?: OnPageSeoResult;
}

export type StrategyImpact = "high" | "medium" | "low";
export type StrategyEffort = "low" | "medium" | "high";

export interface StrategyItem {
  readonly id: string;
  readonly source: string;
  readonly category: string;
  readonly description: string;
  readonly rationale: string;
  readonly impact: StrategyImpact;
  readonly effort: StrategyEffort;
  /** Other sources whose own output independently flagged the same category. */
  readonly confirmedBySources: readonly string[];
  /** Deterministic score from impact, effort, and cross-source confirmation -- see strategy-item-collector.ts. */
  readonly priorityScore: number;
}

export interface PrioritizationMatrix {
  readonly quickWins: readonly StrategyItem[];
  readonly majorProjects: readonly StrategyItem[];
  readonly fillIns: readonly StrategyItem[];
  readonly thankless: readonly StrategyItem[];
}

export interface RoadmapPhase {
  readonly label: string;
  readonly items: readonly StrategyItem[];
}

export interface SeoRoadmap {
  /** Exactly 3 phases, in order: 0-30, 31-60, 61-90 days. */
  readonly phases: readonly RoadmapPhase[];
  /** "Thankless" items (low impact, high effort) -- deliberately excluded from the active phases, never silently dropped. */
  readonly deprioritized: readonly StrategyItem[];
}

export interface ImplementationStep {
  readonly sequence: number;
  readonly source: string;
  readonly category: string;
  readonly action: string;
  readonly rationale: string;
}

export interface SeoStrategyResult {
  readonly requestId: string;
  readonly strategy: readonly StrategyItem[];
  readonly prioritizationMatrix: PrioritizationMatrix;
  readonly roadmap: SeoRoadmap;
  readonly implementationPlan: readonly ImplementationStep[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
