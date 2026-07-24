import { describe, expect, it } from "vitest";
import { ContentTopicClusterBuilder } from "../../../../src/agents/content-strategy-agent/clustering/content-topic-cluster-builder.js";
import type { TopicCluster } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

describe("ContentTopicClusterBuilder", () => {
  const builder = new ContentTopicClusterBuilder();

  it("picks the shortest keyword in a cluster as the pillar keyword", () => {
    const clusters: TopicCluster[] = [
      { label: "plumber", keywords: ["emergency plumber near me", "plumber", "licensed plumber"] },
    ];

    const [result] = builder.build(clusters);

    expect(result?.pillarKeyword).toBe("plumber");
    expect([...(result?.supportingKeywords ?? [])].sort()).toEqual(
      ["emergency plumber near me", "licensed plumber"].sort(),
    );
  });

  it("breaks a length tie alphabetically for determinism", () => {
    // "plumber help" and "plumber jobs" are both exactly 12 characters.
    const clusters: TopicCluster[] = [{ label: "plumber", keywords: ["plumber jobs", "plumber help"] }];

    const [result] = builder.build(clusters);

    expect(result?.pillarKeyword).toBe("plumber help");
  });

  it("preserves the cluster label", () => {
    const clusters: TopicCluster[] = [{ label: "plumber", keywords: ["plumber"] }];
    const [result] = builder.build(clusters);
    expect(result?.label).toBe("plumber");
  });

  it("throws if a cluster has no keywords", () => {
    const clusters: TopicCluster[] = [{ label: "empty", keywords: [] }];
    expect(() => builder.build(clusters)).toThrow(/no keywords/);
  });

  it("returns an empty array for no clusters", () => {
    expect(builder.build([])).toEqual([]);
  });
});
