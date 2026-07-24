// Input/output shapes for the Keyword Research & Search Intent Agent, per
// Agents/keyword-research-agent.md. Inputs and outputs mirror that spec's
// own "Inputs"/"Outputs" sections (Business objectives, Target audience /
// Keyword Research Report, Search Intent Report, Topic Clusters).

import type { KeywordMetrics } from "./keyword-data-provider.types.js";

export type SearchIntent = "informational" | "navigational" | "commercial" | "transactional";

export interface KeywordResearchRequest {
  readonly id: string;
  readonly businessObjective: string;
  readonly seedKeywords: readonly string[];
  readonly targetAudience?: string;
}

/** One seed keyword after classification and (attempted) metrics lookup. */
export interface ClassifiedKeyword {
  readonly keyword: string;
  readonly intent: SearchIntent;
  /** Which textual signal drove the classification -- never a bare label with no explanation. */
  readonly intentRationale: string;
  /** Real metrics if a data provider supplied them; `null` if genuinely unavailable. Never fabricated. */
  readonly metrics: KeywordMetrics | null;
}

export interface TopicCluster {
  readonly label: string;
  readonly keywords: readonly string[];
}

export interface KeywordResearchResult {
  readonly requestId: string;
  readonly classifiedKeywords: readonly ClassifiedKeyword[];
  readonly topicClusters: readonly TopicCluster[];
  /** True only if at least one keyword received real metrics from a configured provider. */
  readonly metricsAvailable: boolean;
  /** Explicit, human-readable acknowledgment of anything this result could not determine (GLOBAL_RULES.md SS1). */
  readonly limitations: readonly string[];
  /** Standing disclaimer per GLOBAL_RULES.md SS6: never guarantee rankings or traffic outcomes. */
  readonly rankingDisclaimer: string;
  readonly decidedAt: string;
}
