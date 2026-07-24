// Elevates the Keyword Research Agent's keyword-level topic clusters into
// content-planning clusters by choosing a pillar keyword for each -- the
// shortest keyword in the cluster (a well-established content-strategy
// convention: broad/short head terms become pillar content, longer-tail
// variations become supporting articles). Purely a re-organization of
// keywords the caller already supplied; nothing is invented.

import type { TopicCluster } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { ContentTopicCluster } from "../types/content-strategy-request.types.js";

export class ContentTopicClusterBuilder {
  build(keywordClusters: readonly TopicCluster[]): ContentTopicCluster[] {
    return keywordClusters.map((cluster) => this.buildOne(cluster));
  }

  private buildOne(cluster: TopicCluster): ContentTopicCluster {
    const sorted = [...cluster.keywords].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const pillarKeyword = sorted[0];
    if (pillarKeyword === undefined) {
      throw new Error(`Topic cluster "${cluster.label}" has no keywords.`);
    }
    return {
      label: cluster.label,
      pillarKeyword,
      supportingKeywords: sorted.slice(1),
    };
  }
}
