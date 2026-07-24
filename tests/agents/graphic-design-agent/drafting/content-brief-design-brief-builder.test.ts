import { describe, expect, it } from "vitest";
import { ContentBriefDesignBriefBuilder } from "../../../../src/agents/graphic-design-agent/drafting/content-brief-design-brief-builder.js";
import type { ContentBrief } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: [],
    recommendedSections: [],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: [],
    ...overrides,
  };
}

describe("ContentBriefDesignBriefBuilder", () => {
  const builder = new ContentBriefDesignBriefBuilder();

  it("returns no briefs when there are no real content briefs", () => {
    expect(builder.build([], null)).toEqual([]);
  });

  it("builds one blog-featured-image brief per real content brief", () => {
    const [brief] = builder.build([makeBrief()], null);
    expect(brief).toMatchObject({ graphicType: "blog-featured-image", source: "content-brief", dimensions: "1200x630" });
    expect(brief?.title).toContain("Emergency Plumbing Guide");
    expect(brief?.description).toContain("emergency plumber");
    expect(brief?.altText).toContain("emergency plumber");
  });

  it("notes when no brand guidelines were supplied", () => {
    const [brief] = builder.build([makeBrief()], null);
    expect(brief?.brandConsistencyNotes).toContain("No brand guidelines were supplied");
  });

  it("echoes real brand guidelines when supplied", () => {
    const [brief] = builder.build([makeBrief()], "Friendly, plain-spoken tone.");
    expect(brief?.brandConsistencyNotes).toContain("Friendly, plain-spoken tone.");
  });
});
