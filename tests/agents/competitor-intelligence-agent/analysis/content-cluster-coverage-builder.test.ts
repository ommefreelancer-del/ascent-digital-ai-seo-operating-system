import { describe, expect, it } from "vitest";
import { ContentClusterCoverageBuilder } from "../../../../src/agents/competitor-intelligence-agent/analysis/content-cluster-coverage-builder.js";
import type { TopicCluster } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { CompetitorSnapshot } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

const CLUSTERS: TopicCluster[] = [
  { label: "plumber", keywords: ["plumber", "emergency plumber"] },
  { label: "photosynthesis", keywords: ["photosynthesis"] },
];

const COMPETITORS: CompetitorSnapshot[] = [
  { id: "competitor-a", html: "<title>Emergency Plumber Guide</title>" },
  { id: "competitor-b", html: "<title>Recipes and Cooking Tips</title><h1>Best Baking Techniques</h1>" },
];

describe("ContentClusterCoverageBuilder", () => {
  const builder = new ContentClusterCoverageBuilder();

  it("marks a competitor as covering a cluster when their title/heading text overlaps it", () => {
    const [plumberCoverage] = builder.build(CLUSTERS, COMPETITORS);
    expect(plumberCoverage?.coveredByCompetitors).toEqual(["competitor-a"]);
  });

  it("does not mark a competitor as covering a cluster with no overlap", () => {
    const photosynthesisCoverage = builder
      .build(CLUSTERS, COMPETITORS)
      .find((c) => c.clusterLabel === "photosynthesis");
    expect(photosynthesisCoverage?.coveredByCompetitors).toEqual([]);
  });

  it("uses headings as well as the title for overlap detection", () => {
    const clusters: TopicCluster[] = [{ label: "baking", keywords: ["baking techniques"] }];
    const [coverage] = builder.build(clusters, COMPETITORS);
    expect(coverage?.coveredByCompetitors).toEqual(["competitor-b"]);
  });

  it("preserves the cluster label and keywords in the result", () => {
    const [coverage] = builder.build(CLUSTERS, []);
    expect(coverage?.clusterLabel).toBe("plumber");
    expect(coverage?.keywords).toEqual(["plumber", "emergency plumber"]);
  });

  it("returns an empty coveredByCompetitors list when no competitors are supplied", () => {
    const [coverage] = builder.build(CLUSTERS, []);
    expect(coverage?.coveredByCompetitors).toEqual([]);
  });
});
