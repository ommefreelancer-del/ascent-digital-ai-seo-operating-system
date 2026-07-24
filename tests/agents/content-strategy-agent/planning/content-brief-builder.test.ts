import { describe, expect, it } from "vitest";
import { ContentBriefBuilder } from "../../../../src/agents/content-strategy-agent/planning/content-brief-builder.js";
import { InternalLinkingRecommender } from "../../../../src/agents/content-strategy-agent/planning/internal-linking-recommender.js";
import type { PillarPageStrategyEntry } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makePillarStrategy(): PillarPageStrategyEntry[] {
  return [
    {
      clusterLabel: "plumber",
      pillarKeyword: "plumber",
      pillarTitle: "The Complete Guide to Plumber",
      pillarIntent: "informational",
      supportingArticles: [
        { keyword: "emergency plumber", intent: "informational", suggestedTitle: "A Complete Guide to Emergency Plumber" },
      ],
      priorityRank: 1,
    },
  ];
}

describe("ContentBriefBuilder", () => {
  const builder = new ContentBriefBuilder();
  const linker = new InternalLinkingRecommender();

  it("produces one brief for the pillar and one per supporting article", () => {
    const pillarStrategy = makePillarStrategy();
    const links = linker.build(pillarStrategy);

    const briefs = builder.build(pillarStrategy, links);

    expect(briefs).toHaveLength(2);
    expect(briefs.map((b) => b.contentType).sort()).toEqual(["pillar", "supporting"]);
  });

  it("gives the pillar brief pillar-length word count guidance and the supporting brief a shorter range", () => {
    const pillarStrategy = makePillarStrategy();
    const briefs = builder.build(pillarStrategy, linker.build(pillarStrategy));

    const pillarBrief = briefs.find((b) => b.contentType === "pillar");
    const supportingBrief = briefs.find((b) => b.contentType === "supporting");

    expect(pillarBrief?.wordCountGuidance).toContain("1,800-3,000");
    expect(supportingBrief?.wordCountGuidance).toContain("800-1,500");
    expect(pillarBrief?.wordCountGuidance).toContain("not a guarantee");
  });

  it("populates internalLinks from the internal linking recommendations for each title", () => {
    const pillarStrategy = makePillarStrategy();
    const links = linker.build(pillarStrategy);

    const briefs = builder.build(pillarStrategy, links);
    const pillarBrief = briefs.find((b) => b.contentType === "pillar");

    expect(pillarBrief?.internalLinks).toEqual(["A Complete Guide to Emergency Plumber"]);
  });

  it("includes recommended sections derived from the target keyword", () => {
    const pillarStrategy = makePillarStrategy();
    const briefs = builder.build(pillarStrategy, []);
    const pillarBrief = briefs.find((b) => b.contentType === "pillar");

    expect(pillarBrief?.recommendedSections).toContain("Introduction");
    expect(pillarBrief?.recommendedSections.some((s) => s.includes("Plumber"))).toBe(true);
  });

  it("lists the pillar keyword plus other supporting keywords as related keywords for a supporting brief", () => {
    const pillarStrategy: PillarPageStrategyEntry[] = [
      {
        clusterLabel: "plumber",
        pillarKeyword: "plumber",
        pillarTitle: "Pillar",
        pillarIntent: "informational",
        supportingArticles: [
          { keyword: "emergency plumber", intent: "informational", suggestedTitle: "Supporting A" },
          { keyword: "licensed plumber", intent: "informational", suggestedTitle: "Supporting B" },
        ],
        priorityRank: 1,
      },
    ];

    const briefs = builder.build(pillarStrategy, []);
    const supportingA = briefs.find((b) => b.title === "Supporting A");

    expect(supportingA?.relatedKeywords).toEqual(
      expect.arrayContaining(["plumber", "licensed plumber"]),
    );
    expect(supportingA?.relatedKeywords).not.toContain("emergency plumber");
  });
});
