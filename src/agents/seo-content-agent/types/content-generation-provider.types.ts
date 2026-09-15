// The seam between "the agent needs real, publication-ready prose" and
// "where that prose actually comes from". This build has zero runtime
// dependencies and never calls an external service -- GLOBAL_RULES.md SS9
// requires explicit human approval before "connecting external services",
// which a real LLM provider (ChatGPT, Claude, etc., per this agent's own
// spec) would be. No concrete provider ships in this build -- only the
// interface and a NullContentGenerationProvider that honestly reports
// "unavailable" (see providers/null-content-generation-provider.ts). A real
// provider can be plugged in later, once explicitly approved, without
// changing SeoContentAgent.
//
// CONTENT FRAMEWORK HARDENING (2026-08-28): `heading`/`title`/`targetKeyword`
// alone gave a provider no way to write a section that fits coherently into
// the REST of the article, distinguish an introduction from a regular H2
// from an FAQ from a conclusion, or judge whether an H3 subdivision is
// genuinely warranted -- the direct cause of "weak article hierarchy" and
// generic, interchangeable sections reported against the live output.
// `allHeadings` (the real, already-decided whole-article outline) and
// `sectionRole` (deterministically inferred from position -- see
// content-section-drafter.ts, never guessed by an LLM) give every section a
// real, structural sense of where it sits.

// CONTENT FRAMEWORK HARDENING (2026-08-29 -- QA revision loop): `qaFeedback`
// on the three request types below is the entire revision mechanism. An
// earlier design asked a provider to re-emit the FULL article as one JSON
// response on a failed QA check -- live testing against a genuinely thorough,
// well-structured 14-section article (exactly what the heading-hierarchy fix
// above now produces) showed that design breaks: the JSON response overflows
// any reasonable token budget and silently returns null, so revision quietly
// never happens for the very articles most likely to need it. Revision is
// instead just a second real pass through the SAME per-piece generation
// calls used the first time (generateSection / generateMetaContent /
// generateFaqQuestions), each carrying the prior QA verdict's failedChecks
// and notes as extra directive context. This is bounded per-call exactly
// like the original generation (no risk of truncation regardless of article
// length) and needs no new provider capability -- see SeoContentAgent's
// Generate -> QA -> revise -> QA-again loop.
export interface QaFeedback {
  readonly failedChecks: readonly string[];
  readonly notes: string;
}

export type ContentSectionRole = "introduction" | "body" | "faq" | "conclusion";

export interface ContentGenerationRequest {
  readonly title: string;
  readonly targetKeyword: string;
  /** The section heading to write body copy for. */
  readonly heading: string;
  /** Free-text brand voice/tone guidance, if the caller supplied any. */
  readonly brandGuidelines: string | null;
  /** The real, full, already-decided outline for this article, in order -- lets a provider write a section that doesn't duplicate or contradict its siblings. */
  readonly allHeadings: readonly string[];
  /** Deterministically inferred from this heading's position in `allHeadings` (first = introduction, a heading matching /conclusion/i = conclusion, a heading matching the FAQ pattern = faq, everything else = body) -- never an LLM guess. */
  readonly sectionRole: ContentSectionRole;
  /** Real related keywords from the same topic cluster (Content Strategy Agent's own output) -- offered as genuine semantic/topical coverage material, never a mandatory density list. */
  readonly relatedKeywords: readonly string[];
  /** Present only on a revision pass -- a real prior QA verdict's failedChecks/notes, so this specific section can address them if they genuinely apply to it. `null`/absent on the first, non-revision pass. */
  readonly qaFeedback?: QaFeedback | null;
}

/** Real, generated prose for one section. Never fabricated locally. */
export interface GeneratedSection {
  readonly heading: string;
  readonly body: string;
}

export interface ContentGenerationProvider {
  readonly name: string;
  /**
   * Resolves to real, generated prose for the requested section, or `null`
   * if generation is unavailable (no provider configured, generation
   * failed, etc). Implementations must never invent placeholder prose here
   * -- `null` is always the correct response when real content cannot be
   * produced.
   */
  generateSection(request: ContentGenerationRequest): Promise<GeneratedSection | null>;

  /**
   * Resolves to a real, unique meta title/description grounded in the
   * article's OWN actual drafted content (not just the bare keyword) -- or
   * `null` if unavailable. Optional: a provider that doesn't implement this
   * (or a caller with no provider at all) falls back to
   * MetaContentBuilder's own deterministic, disclosed template.
   */
  generateMetaContent?(request: MetaGenerationRequest): Promise<GeneratedMetaContent | null>;

  /**
   * Resolves to a real, grounded FAQ answer for one question -- constrained
   * to the same anti-fabrication rule as generateSection() (never invent a
   * fact, statistic, price, or claim not implied by the supplied context;
   * write around it generically instead). `null` when unavailable; the
   * caller falls back to FaqBuilder's own bracketed placeholder.
   */
  generateFaqAnswer?(request: FaqAnswerGenerationRequest): Promise<string | null>;

  /**
   * Resolves to genuinely useful, topic-specific FAQ questions grounded in
   * the article's own real drafted sections -- never the keyword-templated
   * "What is X? / How does X work?" shape. `null` when unavailable; the
   * caller falls back to FaqBuilder's own deterministic question stems.
   */
  generateFaqQuestions?(request: FaqQuestionGenerationRequest): Promise<readonly string[] | null>;

  /**
   * Resolves to a real, structured self-evaluation of one FULLY ASSEMBLED
   * content piece against the Content Writing Framework's own QA checklist
   * -- or `null` if unavailable (never fabricated as an automatic "pass").
   */
  evaluateContent?(request: ContentQaRequest): Promise<ContentQaVerdict | null>;
}

export interface MetaGenerationRequest {
  readonly title: string;
  readonly targetKeyword: string;
  readonly intent: string;
  /** The article's real, already-drafted section bodies (heading + body pairs), so the meta description reflects what the article ACTUALLY covers. */
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  /** Present only on a revision pass -- see ContentGenerationRequest.qaFeedback. */
  readonly qaFeedback?: QaFeedback | null;
}

export interface GeneratedMetaContent {
  readonly metaTitle: string;
  readonly metaDescription: string;
}

export interface FaqAnswerGenerationRequest {
  readonly title: string;
  readonly targetKeyword: string;
  readonly question: string;
  /** Real, already-drafted article sections -- the only material the answer may draw on; never a source for inventing facts beyond what's here. */
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
}

export interface FaqQuestionGenerationRequest {
  readonly title: string;
  readonly targetKeyword: string;
  readonly intent: string;
  readonly relatedKeywords: readonly string[];
  /** Real, already-drafted article sections -- questions must reflect what the article actually covers, not invent new topics. */
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  /** Present only on a revision pass -- see ContentGenerationRequest.qaFeedback. */
  readonly qaFeedback?: QaFeedback | null;
}

export interface ContentQaRequest {
  readonly title: string;
  readonly targetKeyword: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  readonly faqs: readonly { readonly question: string; readonly answer: string }[];
  /**
   * Whether the article's own outline already decided an FAQ section is genuinely warranted for this
   * topic (derived from the real, already-decided recommendedSections -- see FaqBuilder's hasFaqSection()).
   * The faq_useful check MUST be evaluated against this decision, never by independently re-judging
   * topic-appropriateness -- two separate real judgment calls disagreeing (the outline saying no FAQ is
   * needed, evaluateContent separately deciding one is expected) is the exact defect this field closes.
   */
  readonly faqExpected: boolean;
  /** The outline's own stated reason for that decision, when a real outline provider supplied one. */
  readonly faqRationale?: string;
}

export interface ContentQaVerdict {
  readonly passed: boolean;
  /** Real, specific check names the model judged failing (e.g. "keyword_stuffing", "missing_h1", "generic_intro") -- empty when passed. Never a vague "something's wrong". */
  readonly failedChecks: readonly string[];
  /** One or two sentences of real, specific reasoning -- never generic filler. */
  readonly notes: string;
}

