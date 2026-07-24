import { describe, expect, it } from "vitest";
import { ContentGapAnalyzer } from "../../../../src/agents/content-strategy-agent/planning/content-gap-analyzer.js";
import type { ContentTopicCluster } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

const CLUSTERS: ContentTopicCluster[] = [
  { label: "plumber", pillarKeyword: "plumber", supportingKeywords: ["emergency plumber"] },
  { label: "electrician", pillarKeyword: "electrician", supportingKeywords: ["licensed electrician"] },
];

describe("ContentGapAnalyzer", () => {
  const analyzer = new ContentGapAnalyzer();

  it("treats every cluster as a gap and returns a limitation when no inventory is supplied", () => {
    const { gaps, limitation } = analyzer.analyze(CLUSTERS, undefined);

    expect(gaps).toHaveLength(2);
    expect(limitation).toContain("No existingContentInventory was supplied");
  });

  it("treats every cluster as a gap when the inventory is an empty array", () => {
    const { gaps, limitation } = analyzer.analyze(CLUSTERS, []);
    expect(gaps).toHaveLength(2);
    expect(limitation).not.toBeNull();
  });

  it("excludes a cluster covered by an existing content title, with no limitation", () => {
    const { gaps, limitation } = analyzer.analyze(CLUSTERS, ["The Ultimate Plumber Guide"]);

    expect(gaps.map((g) => g.clusterLabel)).toEqual(["electrician"]);
    expect(limitation).toBeNull();
  });

  it("reports no gaps when every cluster is covered", () => {
    const { gaps, limitation } = analyzer.analyze(CLUSTERS, [
      "Plumber Services Overview",
      "Electrician Services Overview",
    ]);

    expect(gaps).toEqual([]);
    expect(limitation).toBeNull();
  });
});
