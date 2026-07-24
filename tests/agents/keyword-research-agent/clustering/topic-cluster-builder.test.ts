import { describe, expect, it } from "vitest";
import { TopicClusterBuilder } from "../../../../src/agents/keyword-research-agent/clustering/topic-cluster-builder.js";

describe("TopicClusterBuilder", () => {
  const builder = new TopicClusterBuilder();

  it("groups keywords that share a significant term", () => {
    // "plumber" is the only term shared by more than one keyword here, so
    // there is no tie with another candidate grouping to worry about.
    const clusters = builder.build(["emergency plumber", "licensed plumber", "electrician near me"]);

    const plumberCluster = clusters.find((c) => c.keywords.includes("emergency plumber"));
    expect(plumberCluster?.keywords).toEqual(
      expect.arrayContaining(["emergency plumber", "licensed plumber"]),
    );
  });

  it("gives a keyword with no shared term its own single-keyword cluster", () => {
    const clusters = builder.build(["emergency plumber", "plumber near me", "photosynthesis"]);

    const soloCluster = clusters.find((c) => c.keywords.includes("photosynthesis"));
    expect(soloCluster).toEqual({ label: "photosynthesis", keywords: ["photosynthesis"] });
  });

  it("assigns each keyword to exactly one cluster", () => {
    const keywords = ["emergency plumber", "plumber near me", "electrician near me", "best electrician"];
    const clusters = builder.build(keywords);

    const allClusteredKeywords = clusters.flatMap((c) => c.keywords);
    expect(allClusteredKeywords.sort()).toEqual([...keywords].sort());
  });

  it("prefers the larger shared-term group when a keyword could fit more than one", () => {
    // "near me" is shared by two pairs; "plumber" is shared by only one pair.
    const clusters = builder.build([
      "plumber near me",
      "electrician near me",
      "roofer near me",
      "emergency plumber",
    ]);

    const nearMeCluster = clusters.find((c) => c.label === "near");
    expect(nearMeCluster?.keywords).toEqual(
      expect.arrayContaining(["plumber near me", "electrician near me", "roofer near me"]),
    );
  });

  it("returns an empty array for no keywords", () => {
    expect(builder.build([])).toEqual([]);
  });
});
