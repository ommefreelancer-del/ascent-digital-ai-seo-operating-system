// Identifies content gaps by comparing topic clusters against an existing
// content inventory the caller supplies. GLOBAL_RULES.md SS2 forbids
// fabricating data: if no inventory is supplied, this analyzer does not
// guess what already exists -- it explicitly reports every cluster as an
// unverified potential gap and returns a limitation saying so, rather than
// silently treating "unknown" as "definitely missing".

import type { ContentTopicCluster } from "../types/content-strategy-request.types.js";
import type { ContentGap } from "../types/content-strategy-request.types.js";

const MIN_TOKEN_LENGTH = 3;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= MIN_TOKEN_LENGTH));
}

function hasOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const token of a) {
    if (b.has(token)) {
      return true;
    }
  }
  return false;
}

export interface ContentGapAnalysis {
  readonly gaps: readonly ContentGap[];
  /** Non-null when the analysis had to fall back to "no inventory supplied". */
  readonly limitation: string | null;
}

export class ContentGapAnalyzer {
  analyze(
    clusters: readonly ContentTopicCluster[],
    existingContentInventory: readonly string[] | undefined,
  ): ContentGapAnalysis {
    if (!existingContentInventory || existingContentInventory.length === 0) {
      return {
        gaps: clusters.map((cluster) => ({
          clusterLabel: cluster.label,
          keywords: [cluster.pillarKeyword, ...cluster.supportingKeywords],
          rationale: "No existing content inventory was supplied; treated as a potential gap by default.",
        })),
        limitation:
          "No existingContentInventory was supplied; content gap analysis defaulted to treating every " +
          "topic cluster as a potential gap. Supply existingContentInventory for an accurate comparison.",
      };
    }

    const existingTokenSets = existingContentInventory.map((title) => tokenize(title));
    const gaps: ContentGap[] = [];
    for (const cluster of clusters) {
      const clusterTokens = tokenize([cluster.pillarKeyword, ...cluster.supportingKeywords].join(" "));
      const isCovered = existingTokenSets.some((existingTokens) => hasOverlap(clusterTokens, existingTokens));
      if (!isCovered) {
        gaps.push({
          clusterLabel: cluster.label,
          keywords: [cluster.pillarKeyword, ...cluster.supportingKeywords],
          rationale: "No existing content title shares a significant term with this topic cluster.",
        });
      }
    }

    return { gaps, limitation: null };
  }
}
