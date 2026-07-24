import { describe, expect, it } from "vitest";
import { PillarStrategyBuilder } from "../../../../src/agents/content-strategy-agent/planning/pillar-strategy-builder.js";
import type { ContentTopicCluster } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { ClassifiedKeyword } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function classified(keyword: string, intent: ClassifiedKeyword["intent"]): ClassifiedKeyword {
  return { keyword, intent, intentRationale: "test", metrics: null };
}

describe("PillarStrategyBuilder", () => {
  const builder = new PillarStrategyBuilder();

  it("builds a pillar entry with a titled supporting article per supporting keyword", () => {
    const clusters: ContentTopicCluster[] = [
      { label: "plumber", pillarKeyword: "plumber", supportingKeywords: ["emergency plumber"] },
    ];
    const classifiedKeywords = [classified("plumber", "informational"), classified("emergency plumber", "informational")];

    const [entry] = builder.build(clusters, classifiedKeywords);

    expect(entry?.pillarKeyword).toBe("plumber");
    expect(entry?.pillarTitle).toContain("Plumber");
    expect(entry?.supportingArticles).toHaveLength(1);
    expect(entry?.supportingArticles[0]?.keyword).toBe("emergency plumber");
  });

  it("selects a title convention based on the keyword's classified intent", () => {
    const clusters: ContentTopicCluster[] = [
      { label: "shoes", pillarKeyword: "shoes", supportingKeywords: ["buy running shoes"] },
    ];
    const classifiedKeywords = [classified("shoes", "informational"), classified("buy running shoes", "transactional")];

    const [entry] = builder.build(clusters, classifiedKeywords);

    expect(entry?.supportingArticles[0]?.suggestedTitle).toContain("Buy");
  });

  it("defaults to informational intent when a keyword has no classification on record", () => {
    const clusters: ContentTopicCluster[] = [
      { label: "shoes", pillarKeyword: "shoes", supportingKeywords: ["shoe care"] },
    ];

    const [entry] = builder.build(clusters, []);

    expect(entry?.pillarIntent).toBe("informational");
    expect(entry?.supportingArticles[0]?.intent).toBe("informational");
  });

  it("ranks larger clusters (more supporting keywords) with a better priorityRank", () => {
    const clusters: ContentTopicCluster[] = [
      { label: "small", pillarKeyword: "small topic", supportingKeywords: [] },
      { label: "big", pillarKeyword: "big topic", supportingKeywords: ["a", "b", "c"] },
    ];

    const result = builder.build(clusters, []);

    const big = result.find((entry) => entry.clusterLabel === "big");
    const small = result.find((entry) => entry.clusterLabel === "small");
    expect(big?.priorityRank).toBe(1);
    expect(small?.priorityRank).toBe(2);
  });

  it("assigns priorityRank 1..N with no gaps or duplicates", () => {
    const clusters: ContentTopicCluster[] = [
      { label: "a", pillarKeyword: "a", supportingKeywords: [] },
      { label: "b", pillarKeyword: "b", supportingKeywords: ["b1"] },
      { label: "c", pillarKeyword: "c", supportingKeywords: ["c1", "c2"] },
    ];

    const result = builder.build(clusters, []);

    expect(result.map((entry) => entry.priorityRank).sort()).toEqual([1, 2, 3]);
  });
});
