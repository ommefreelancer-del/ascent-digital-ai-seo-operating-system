import { describe, expect, it } from "vitest";
import { FaqBuilder } from "../../../../src/agents/seo-content-agent/drafting/faq-builder.js";
import type { ContentBrief } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: ["24/7 plumber"],
    recommendedSections: ["Introduction", "Frequently Asked Questions", "Conclusion"],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: [],
    ...overrides,
  };
}

describe("FaqBuilder", () => {
  const builder = new FaqBuilder();

  it("returns no FAQs when the brief's outline has no FAQ section", () => {
    const brief = makeBrief({ recommendedSections: ["Introduction", "Conclusion"] });
    expect(builder.build(brief)).toEqual([]);
  });

  it("returns FAQ question stems when the outline calls for an FAQ section", () => {
    const faqs = builder.build(makeBrief());
    expect(faqs.length).toBeGreaterThan(0);
    expect(faqs.every((faq) => faq.question.includes("emergency plumber"))).toBe(true);
  });

  it("never fabricates an answer -- every item carries the bracketed placeholder", () => {
    const faqs = builder.build(makeBrief());
    expect(faqs.every((faq) => faq.answerPlaceholder.startsWith("["))).toBe(true);
  });

  it("adds a cost question for transactional/commercial intent", () => {
    const transactional = builder.build(makeBrief({ intent: "transactional" }));
    const informational = builder.build(makeBrief({ intent: "informational" }));
    expect(transactional.some((faq) => faq.question.toLowerCase().includes("cost"))).toBe(true);
    expect(informational.some((faq) => faq.question.toLowerCase().includes("cost"))).toBe(false);
  });

  it("adds a comparison question only when related keywords exist", () => {
    const withRelated = builder.build(makeBrief({ relatedKeywords: ["24/7 plumber"] }));
    const withoutRelated = builder.build(makeBrief({ relatedKeywords: [] }));
    expect(withRelated.some((faq) => faq.question.includes("compare"))).toBe(true);
    expect(withoutRelated.some((faq) => faq.question.includes("compare"))).toBe(false);
  });
});
