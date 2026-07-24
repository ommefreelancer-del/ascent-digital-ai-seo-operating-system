// Deterministic topic clustering: groups seed keywords that share a
// significant term, so the agent can report "Topic Clusters"
// (Agents/keyword-research-agent.md) without any external data -- this is
// pure text grouping over the keywords the caller already supplied, not a
// claim about real-world search behavior.

import type { TopicCluster } from "../types/keyword-request.types.js";

const MIN_TOKEN_LENGTH = 3;
const MIN_CLUSTER_SIZE = 2;

function tokenize(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

export class TopicClusterBuilder {
  /**
   * Groups keywords by their most shared token first (largest groups win),
   * so each keyword is assigned to exactly one cluster. Any keyword sharing
   * no token with another (after a minimum cluster size of two) becomes its
   * own single-keyword cluster rather than being dropped.
   */
  build(keywords: readonly string[]): TopicCluster[] {
    const tokenToKeywords = new Map<string, string[]>();
    for (const keyword of keywords) {
      for (const token of new Set(tokenize(keyword))) {
        const list = tokenToKeywords.get(token) ?? [];
        list.push(keyword);
        tokenToKeywords.set(token, list);
      }
    }

    const rankedTokens = Array.from(tokenToKeywords.entries()).sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );

    const assigned = new Set<string>();
    const clusters: TopicCluster[] = [];

    for (const [token, keywordsForToken] of rankedTokens) {
      const unassigned = keywordsForToken.filter((keyword) => !assigned.has(keyword));
      if (unassigned.length < MIN_CLUSTER_SIZE) {
        continue;
      }
      unassigned.forEach((keyword) => assigned.add(keyword));
      clusters.push({ label: token, keywords: unassigned });
    }

    for (const keyword of keywords) {
      if (!assigned.has(keyword)) {
        clusters.push({ label: keyword, keywords: [keyword] });
        assigned.add(keyword);
      }
    }

    return clusters;
  }
}
