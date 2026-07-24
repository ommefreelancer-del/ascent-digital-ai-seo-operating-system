import { describe, expect, it } from "vitest";
import { MetaContentBuilder } from "../../../../src/agents/seo-content-agent/drafting/meta-content-builder.js";
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

describe("MetaContentBuilder", () => {
  const builder = new MetaContentBuilder();

  it("uses a generic bracketed brand placeholder when no brand guidelines were supplied", () => {
    const draft = builder.build(makeBrief(), null);
    expect(draft.metaTitle).toContain("[Your Brand]");
  });

  it("notes that brand guidelines were supplied without inventing a real brand name", () => {
    const draft = builder.build(makeBrief(), "Friendly, plain-spoken tone.");
    expect(draft.metaTitle).toContain("[Your Brand -- see supplied brand guidelines]");
  });

  it("varies the meta title template by classified intent", () => {
    const transactional = builder.build(makeBrief({ intent: "transactional" }), null);
    const commercial = builder.build(makeBrief({ intent: "commercial" }), null);
    const navigational = builder.build(makeBrief({ intent: "navigational" }), null);
    const informational = builder.build(makeBrief({ intent: "informational" }), null);

    expect(transactional.metaTitle).toMatch(/^Buy /);
    expect(commercial.metaTitle).toMatch(/^Best /);
    expect(navigational.metaTitle).toContain("Official Page");
    expect(informational.metaTitle).toContain("Complete Guide");
  });

  it("includes a bracketed placeholder in the meta description for what it cannot know", () => {
    const draft = builder.build(makeBrief(), null);
    expect(draft.metaDescription).toMatch(/\[.*\]/);
  });

  it("uses the real target keyword in both the title and description", () => {
    const draft = builder.build(makeBrief({ targetKeyword: "leaky faucet repair" }), null);
    expect(draft.metaTitle.toLowerCase()).toContain("leaky faucet repair");
    expect(draft.metaDescription.toLowerCase()).toContain("leaky faucet repair");
  });
});
