// Assembles a real ContentBrief plus its already-drafted meta content,
// sections, and FAQs into a single ContentPieceDraft. contentType is a
// deterministic mapping from the brief's own real contentType ("pillar" is
// cornerstone/full-page content -> "website-page"; "supporting" is a
// shorter article -> "blog-post"), not a guess.

import type { ContentBrief, ContentType } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import type { ContentPieceDraft, ContentSectionDraft, FaqItem, SeoContentPieceType } from "../types/seo-content-request.types.js";
import type { MetaContentDraft } from "./meta-content-builder.js";

function contentTypeFor(briefContentType: ContentType): SeoContentPieceType {
  return briefContentType === "pillar" ? "website-page" : "blog-post";
}

export class ContentPieceAssembler {
  assemble(
    brief: ContentBrief,
    metaContent: MetaContentDraft,
    sections: readonly ContentSectionDraft[],
    faqs: readonly FaqItem[],
  ): ContentPieceDraft {
    return {
      title: brief.title,
      contentType: contentTypeFor(brief.contentType),
      targetKeyword: brief.targetKeyword,
      metaTitle: metaContent.metaTitle,
      metaDescription: metaContent.metaDescription,
      sections,
      faqs,
      wordCountGuidance: brief.wordCountGuidance,
      internalLinks: brief.internalLinks,
    };
  }
}
