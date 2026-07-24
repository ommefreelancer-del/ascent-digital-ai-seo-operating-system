// Input/output shapes for the SEO Content Agent, per
// Agents/seo-content-agent.md. This agent drafts content from the real,
// already-computed ContentBrief objects the Content Strategy Agent
// produced -- it never re-derives topics, keywords, or section outlines on
// its own. Meta titles/descriptions and FAQ question stems are deterministic
// templates tied to the brief's real target keyword and classified intent,
// with bracketed placeholders for anything only a human (or an approved LLM
// provider) can supply (brand voice, actual answers, actual body prose) --
// the same convention OnPageSeoAgent's TitleMetaRecommender already uses.
// With no ContentGenerationProvider configured (the default), every
// section's body is a placeholder instruction, never fabricated prose.

import type { ContentStrategyResult } from "../../content-strategy-agent/types/content-strategy-request.types.js";
import type { KeywordResearchResult } from "../../keyword-research-agent/types/keyword-request.types.js";
import type { SeoStrategyResult } from "../../seo-strategy-agent/types/seo-strategy-request.types.js";

export interface SeoContentRequest {
  readonly id: string;
  readonly businessObjective: string;
  readonly contentStrategy: ContentStrategyResult;
  readonly keywordResearch: KeywordResearchResult;
  /** Optional: reflected in prioritization context if supplied, otherwise its absence is stated as a limitation. */
  readonly seoStrategy?: SeoStrategyResult;
  /** Optional free-text brand voice/tone guidance. Echoed into each draft, never invented if omitted. */
  readonly brandGuidelines?: string;
}

/** Derived deterministically from ContentBrief.contentType -- see content-piece-drafter.ts. */
export type SeoContentPieceType = "website-page" | "blog-post";

export interface FaqItem {
  readonly question: string;
  /** Bracketed placeholder -- this agent never invents a real answer. */
  readonly answerPlaceholder: string;
}

export interface ContentSectionDraft {
  readonly heading: string;
  /** Real generated prose if a ContentGenerationProvider supplied it; otherwise a bracketed placeholder instruction. */
  readonly body: string;
  /** True only when `body` is real, provider-generated prose. */
  readonly isGenerated: boolean;
}

export interface ContentPieceDraft {
  readonly title: string;
  readonly contentType: SeoContentPieceType;
  readonly targetKeyword: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly sections: readonly ContentSectionDraft[];
  readonly faqs: readonly FaqItem[];
  readonly wordCountGuidance: string;
  readonly internalLinks: readonly string[];
}

export interface SeoContentResult {
  readonly requestId: string;
  readonly contentDrafts: readonly ContentPieceDraft[];
  /** True only when at least one section received real, provider-generated prose. */
  readonly dataAvailable: boolean;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}
