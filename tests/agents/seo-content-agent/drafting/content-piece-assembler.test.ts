import { describe, expect, it } from "vitest";
import { ContentPieceAssembler } from "../../../../src/agents/seo-content-agent/drafting/content-piece-assembler.js";
import type { ContentBrief } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";
import type { ContentSectionDraft, FaqItem } from "../../../../src/agents/seo-content-agent/types/seo-content-request.types.js";

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    title: "Emergency Plumbing Guide",
    contentType: "pillar",
    targetKeyword: "emergency plumber",
    intent: "informational",
    clusterLabel: "emergency plumber",
    relatedKeywords: ["24/7 plumber"],
    recommendedSections: ["Introduction"],
    wordCountGuidance: "1,800-3,000 words.",
    internalLinks: ["Local Plumbing Services"],
    ...overrides,
  };
}

const metaContent = { metaTitle: "Emergency Plumber: The Complete Guide | [Your Brand]", metaDescription: "Learn everything..." };
const sections: ContentSectionDraft[] = [{ heading: "Introduction", body: "[placeholder]", isGenerated: false }];
const faqs: FaqItem[] = [{ question: "What is emergency plumber?", answerPlaceholder: "[placeholder]" }];

describe("ContentPieceAssembler", () => {
  const assembler = new ContentPieceAssembler();

  it("maps a pillar brief to a website-page content piece", () => {
    const draft = assembler.assemble(makeBrief({ contentType: "pillar" }), metaContent, sections, faqs);
    expect(draft.contentType).toBe("website-page");
  });

  it("maps a supporting brief to a blog-post content piece", () => {
    const draft = assembler.assemble(makeBrief({ contentType: "supporting" }), metaContent, sections, faqs);
    expect(draft.contentType).toBe("blog-post");
  });

  it("passes through the real title, target keyword, word count guidance, and internal links unchanged", () => {
    const draft = assembler.assemble(makeBrief(), metaContent, sections, faqs);
    expect(draft.title).toBe("Emergency Plumbing Guide");
    expect(draft.targetKeyword).toBe("emergency plumber");
    expect(draft.wordCountGuidance).toBe("1,800-3,000 words.");
    expect(draft.internalLinks).toEqual(["Local Plumbing Services"]);
  });

  it("carries the already-built meta content, sections, and FAQs through unchanged", () => {
    const draft = assembler.assemble(makeBrief(), metaContent, sections, faqs);
    expect(draft.metaTitle).toBe(metaContent.metaTitle);
    expect(draft.metaDescription).toBe(metaContent.metaDescription);
    expect(draft.sections).toBe(sections);
    expect(draft.faqs).toBe(faqs);
  });
});
