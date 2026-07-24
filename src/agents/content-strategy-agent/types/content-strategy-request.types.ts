// Input/output shapes for the Content Strategy Agent, per
// Agents/content-strategy-agent.md. Consumes a real KeywordResearchResult
// from the Keyword Research Agent (src/agents/keyword-research-agent) --
// every keyword, cluster, and intent used here traces back to that upstream
// result, never invented independently. Any upstream limitation (e.g. "no
// metrics provider configured") is carried forward into this agent's own
// `limitations`, never dropped.

import type { KeywordResearchResult, SearchIntent } from "../../keyword-research-agent/types/keyword-request.types.js";

export interface ContentStrategyRequest {
  readonly id: string;
  readonly businessObjective: string;
  readonly keywordResearch: KeywordResearchResult;
  readonly targetAudience?: string;
  /** Existing published content titles/topics, for gap analysis. Omit if unknown -- see ContentGapAnalyzer. */
  readonly existingContentInventory?: readonly string[];
  /** ISO date the editorial calendar should start from. Defaults to "now" if omitted. */
  readonly calendarStartDate?: string;
  /** How many pieces of content to schedule per 7-day period. Defaults to 2. */
  readonly articlesPerWeek?: number;
}

/** A keyword-research topic cluster elevated into a content-planning cluster. */
export interface ContentTopicCluster {
  readonly label: string;
  /** The broadest/shortest keyword in the cluster -- becomes the pillar page's target. */
  readonly pillarKeyword: string;
  readonly supportingKeywords: readonly string[];
}

export type ContentType = "pillar" | "supporting";

export interface SupportingArticleBrief {
  readonly keyword: string;
  readonly intent: SearchIntent;
  readonly suggestedTitle: string;
}

export interface PillarPageStrategyEntry {
  readonly clusterLabel: string;
  readonly pillarKeyword: string;
  readonly pillarTitle: string;
  readonly pillarIntent: SearchIntent;
  readonly supportingArticles: readonly SupportingArticleBrief[];
  /** 1 = highest priority. Ranked by cluster size (a real, computable signal), not a fabricated metric. */
  readonly priorityRank: number;
}

export interface InternalLinkRecommendation {
  readonly fromTitle: string;
  readonly toTitle: string;
  readonly reason: string;
}

export interface EditorialCalendarEntry {
  readonly scheduledDate: string;
  readonly contentType: ContentType;
  readonly title: string;
  readonly targetKeyword: string;
  readonly clusterLabel: string;
}

export interface ContentGap {
  readonly clusterLabel: string;
  readonly keywords: readonly string[];
  readonly rationale: string;
}

export interface ContentBrief {
  readonly title: string;
  readonly contentType: ContentType;
  readonly targetKeyword: string;
  readonly intent: SearchIntent;
  readonly clusterLabel: string;
  readonly relatedKeywords: readonly string[];
  readonly recommendedSections: readonly string[];
  /** A general industry-convention range, explicitly not a ranking/traffic guarantee. */
  readonly wordCountGuidance: string;
  readonly internalLinks: readonly string[];
}

export interface ContentStrategyResult {
  readonly requestId: string;
  readonly topicClusters: readonly ContentTopicCluster[];
  readonly pillarPageStrategy: readonly PillarPageStrategyEntry[];
  readonly internalLinkingRecommendations: readonly InternalLinkRecommendation[];
  readonly editorialCalendar: readonly EditorialCalendarEntry[];
  readonly contentGaps: readonly ContentGap[];
  readonly contentBriefs: readonly ContentBrief[];
  /** Every limitation carried forward from upstream plus any found here -- never silently dropped. */
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
