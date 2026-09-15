// A real ContentGenerationProvider backed by the official Google Gemini API
// (https://ai.google.dev/gemini-api/docs), via Google's official Node.js SDK
// (@google/genai, https://ai.google.dev/gemini-api/docs/quickstart). This is
// an explicit opt-in, alternative to ../../seo-content-agent/providers/
// anthropic-content-generation-provider.ts: SeoContentAgent.create() still
// defaults to NullContentGenerationProvider, and this file deliberately does
// not touch that Anthropic provider or web/src/server/backend/specialist-ai.ts
// (the separate, already-live, already-production Claude-based system every
// one of ADASOS's 27 agents already uses for its chat responses) -- adding a
// second production LLM here does not replace or compete with that; it is a
// second, independently-selectable real implementation of this one narrow
// interface (SEO content generation), reusing the exact same seam pattern
// the Anthropic provider already established -- including its prompt
// content (see that file's own "CONTENT FRAMEWORK HARDENING" header for the
// full rationale; kept identical here for parity between the two providers).
//
// Model: gemini-flash-latest by default -- Google's own rolling alias for
// the current stable Flash model, confirmed working with a real API call
// during implementation. The originally-selected "gemini-2.5-flash" (matched
// against ai.google.dev/gemini-api/docs/models and the installed SDK's own
// JSDoc examples at the time) was found, via that same real call, to now
// return a real 404 from Google: "This model models/gemini-2.5-flash is no
// longer available to new users." Google's model lineup moves fast enough
// that a hardcoded specific version is a real reliability risk; the rolling
// alias avoids repeating this exact failure. Pin a specific version via
// GOOGLE_GEMINI_MODEL if you need reproducible behavior across a model
// rollover.
//
// Cost/safety: a Gemini API key from Google AI Studio (ai.google.dev) is
// free by default and, per Google's own documentation, CANNOT incur charges
// on its own -- moving from the free tier to a billed tier requires a
// separate, explicit, human action in Google Cloud Console ("set up and link
// an active billing account"). This module never sets `vertexai: true` (the
// GoogleGenAI SDK's alternate, always-billed Vertex AI backend), so it only
// ever talks to the free-tier-eligible Gemini Developer API path.
//
// BEGINNER-FIRST / SEARCH-INTENT HARDENING (2026-09-05): kept identical to
// anthropic-content-generation-provider.ts's own prompts -- see that file's
// header for the full rationale (search-intent-first framing, beginner ->
// practical -> deeper -> advanced structure, the what-is-it / why-it-matters
// / what-should-the-reader-do formula, the reader-value bar, the no-
// unqualified-ranking-claims rule, and the FAQ no-hedge-then-speculate rule).
//
// TEMPORARY VALIDATION-MODE WORD CAP: `SEO_CONTENT_VALIDATION_MAX_WORDS`,
// read by validationWordCap() below -- kept identical to the sibling
// Anthropic provider's own knob for the same reason (bounding API/credit
// spend while validating the above prompt changes). Unset (the default),
// it changes nothing.
//
// On any failure (no API key configured, the API call fails, Gemini returns
// no text), every method returns `null` rather than fabricating placeholder
// prose -- the same "unavailable, not guessed" contract every provider in
// this codebase follows.

import { GoogleGenAI } from "@google/genai";
import { GeminiRateLimiter } from "./gemini-rate-limiter.js";
import type {
  ContentGenerationProvider,
  ContentGenerationRequest,
  ContentQaRequest,
  ContentQaVerdict,
  ContentSectionRole,
  FaqAnswerGenerationRequest,
  FaqQuestionGenerationRequest,
  GeneratedMetaContent,
  GeneratedSection,
  MetaGenerationRequest,
  QaFeedback,
} from "../types/content-generation-provider.types.js";

const DEFAULT_MODEL = "gemini-flash-latest";
// BEGINNER-FIRST / SEARCH-INTENT HARDENING (2026-09-05): kept in parity with the sibling Anthropic
// provider's own raise -- see that file's constant for the full rationale (a live validation run showed
// the richer per-section guidance can genuinely need more than 1536 tokens, and a truncated mid-sentence
// section is a real defect, not an acceptable length trade-off).
const SECTION_MAX_OUTPUT_TOKENS = 2048;
const META_MAX_OUTPUT_TOKENS = 400;
const FAQ_ANSWER_MAX_OUTPUT_TOKENS = 400;
const FAQ_QUESTIONS_MAX_OUTPUT_TOKENS = 500; // headroom for ~6 questions, up from a 2-5 guidance
const QA_MAX_OUTPUT_TOKENS = 700;
// LIVE VALIDATION FIX (2026-08-31): a live run showed repeated real "This operation was aborted" call
// failures under genuine Gemini-side load ("This model is currently experiencing high demand" 503s were
// also observed in the same run) -- 30s was cutting off calls that would otherwise have succeeded a
// little slower. 45s gives real slow-but-genuine responses more room without being unbounded.
const REQUEST_TIMEOUT_MS = 45_000;

// Appended to a prompt only on a revision pass -- kept identical to
// anthropic-content-generation-provider.ts's own function; see QaFeedback's
// header in content-generation-provider.types.ts for why revision works this
// way instead of asking for the whole article back as one JSON blob.
function qaFeedbackBlock(feedback: QaFeedback | null | undefined): string {
  if (!feedback) return "";
  return [
    "",
    "A prior editorial QA pass flagged this content and it is now being revised:",
    `Failed checks: ${feedback.failedChecks.join(", ") || "(none named)"}`,
    `QA notes: ${feedback.notes}`,
    "Address any of the above that genuinely apply to THIS specific piece. If none of it applies here, keep this piece as strong as it already is -- do not change it just to look different, and never invent a new fact to satisfy a check.",
  ].join("\n");
}

// Kept identical to anthropic-content-generation-provider.ts's own constant -- see that file's header for why.
const SHARED_WRITING_RULES = [
  "Write for the human reader first -- the goal is genuinely useful, original, clearly explained content, never content written merely to manipulate search rankings.",
  "Never invent facts, statistics, dates, prices, studies, quotations, expert opinions, testimonials, or first-hand experience that weren't given to you. If a specific fact would strengthen the section but you don't have it, write around it generically instead of making one up.",
  "Use the target keyword naturally wherever it genuinely fits -- never force it in for a density target, never repeat it awkwardly. If a sentence sounds unnatural with the keyword in it, don't use it there.",
  "Use closely related terms, synonyms, and naturally associated concepts for topical depth -- but only where they genuinely fit the meaning, never as a mandatory checklist.",
  "Write in clear, natural English: active voice where it reads better, varied sentence length and structure, natural contractions, natural transitions. Avoid repetitive sentence patterns, excessive jargon, and unnecessary complexity.",
  "Do not open with generic AI clichés like \"In today's fast-paced world\", \"Whether you're a beginner or an expert\", or \"Have you ever wondered\" unless it is genuinely the most natural way to start.",
  "Only use a list, table, or comparison structure if it genuinely improves clarity for this specific content -- never insert one purely for visual/SEO decoration.",
  "If you use an illustrative analogy or comparison to explain a concept, make it specific to what THIS section is explaining -- do not reach for a generic, overused comparison. Other sections of this same article may already use their own analogy, so keep yours distinct rather than repeating a common one.",
  "Never suggest, describe, or reference an image, photo, diagram, or other visual in any way -- no \"Image suggestion:\", no filename/ALT text/placement notes, and no Markdown image syntax like ![...](...). Image selection is handled entirely separately, outside this text. Write only this section's own reader-facing prose.",
  "Every sentence you keep must clear a real reader-value bar: it helps the reader understand something, solve a problem, decide something, or take a concrete next step. If a sentence doesn't clear that bar, cut it or shorten it rather than keeping it to fill space -- never pad for length or word count.",
  "Prioritize must-know, beginner-relevant information before supporting or advanced detail. Assume the reader is new to this specific topic unless the target keyword itself signals otherwise, and move from beginner basics, to practical guidance, to deeper detail naturally -- never front-load complexity or jargon a beginner didn't ask for. Keep advanced/technical material brief, or leave it out, unless the reader's question genuinely requires it.",
  "Never make an absolute or unqualified ranking, traffic, or results claim (e.g. \"this will rank #1\", \"this guarantees more traffic\"), and never state a specific technique's effect on search rankings as settled fact -- qualify claims about outcomes appropriately.",
].join("\n- ");

// TEMPORARY VALIDATION-MODE WORD CAP -- see this file's header. `null` (the default, env var unset)
// means unconstrained generation, identical to this file's behavior before this cap existed.
function validationWordCap(): number | null {
  const raw = process.env["SEO_CONTENT_VALIDATION_MAX_WORDS"];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Splits a whole-article word cap evenly across the outline's real section count, with a small floor
// so no single section is squeezed to nothing. Never called unless validationWordCap() returned non-null.
function sectionWordBudget(totalWordCap: number, sectionCount: number): number {
  return Math.max(30, Math.floor(totalWordCap / Math.max(1, sectionCount)));
}

function brandLine(brandGuidelines: string | null): string {
  return brandGuidelines
    ? `Brand voice/tone guidance: ${brandGuidelines}`
    : "No specific brand voice guidance was supplied; write in a clear, professional, people-first tone.";
}

function roleGuidance(role: ContentSectionRole, heading: string, targetKeyword: string): string {
  switch (role) {
    case "introduction":
      return [
        "This is the article's INTRODUCTION. Before writing, silently work out: the primary search intent behind " +
          `this exact query ("${targetKeyword}"), the one main question the reader most needs answered, and this ` +
          "reader's likely experience level (default to a beginner to this specific topic unless the keyword itself " +
          "signals an advanced audience). Every section in this article exists to satisfy that intent -- this " +
          "introduction sets it up, it doesn't need to restate your reasoning.",
        "Structure it as:",
        "1. First, directly establish the topic, problem, or definition the reader came here for, in terms a " +
          "beginner to this topic can follow.",
        "2. Then give a natural, reader-focused reason this topic matters (not a generic hook).",
        "3. Only if it genuinely helps, briefly note what the article will cover.",
        "Do not write a heading or title -- just the introduction prose itself.",
      ].join("\n");
    case "faq":
      // Not called by the real pipeline (ContentSectionDrafter skips generateSection entirely for the FAQ
      // heading -- see that file's own header for why a separate lead-in sentence was found to be redundant filler).
      // Kept only so a direct caller of this provider gets a safe instruction, never a fabricated lead-in.
      return `This is the article's FAQ section heading (heading: "${heading}"). Return an empty string -- the real FAQ questions and answers are rendered separately; no lead-in sentence is needed.`;
    case "conclusion":
      return [
        "This is the article's CONCLUSION. Summarize the genuinely useful takeaway from the article -- do not simply " +
          "restate the introduction in different words.",
        `Include the target keyword ("${targetKeyword}") only if it fits naturally.`,
        "End with a concrete, reader-oriented next step or takeaway, not a generic closing line.",
      ].join("\n");
    case "body":
    default:
      return [
        `This is a body section covering one real aspect of the topic (heading: "${heading}"). Before writing, ` +
          `silently work out the exact question a reader searching for "${targetKeyword}" needs THIS section to ` +
          "answer, and the single most useful takeaway or next step it should leave them with -- then write to " +
          "serve that, not a generic overview. Cover it with genuine explanation, context, and (where useful) " +
          "examples or practical guidance -- not one shallow paragraph.",
        "Where it fits naturally (never force the labels into the visible text), shape substantial parts of this " +
          "section as: what it is -> why it matters to the reader -> what the reader should actually do about it. " +
          "Skip whichever part of that shape doesn't genuinely apply here.",
        "Cover must-know information before nice-to-know detail. If this topic could go deeper into advanced or " +
          "technical territory, do that only after the practical basics are covered, and keep the deeper material " +
          "brief unless the reader's actual question requires it -- don't dump advanced detail on a reader who " +
          "hasn't been given the basics yet.",
        "This heading is an H2. Before writing, check whether this section actually contains more than one of: " +
          "distinct steps in a sequence, distinct methods/approaches/tools/products/categories being covered side by " +
          "side, distinct examples, or distinct sub-questions. This is common -- most real H2 sections that cover " +
          "genuine ground DO contain this, not just the occasional one.",
        "- If it does: make that structure VISIBLE. Use a real Markdown H3 (###) for each distinct step/method/" +
          "category -- not a bolded lead-in phrase buried inside one continuous paragraph, and not one long block of " +
          "text that mentions several things in a row without breaking them apart. A numbered or bulleted list is the " +
          "right choice instead of H3s when the items are short and parallel (e.g. a list of tools, a quick set of " +
          "steps) rather than each needing its own explanation.",
        "- If one of those H3 subsections itself genuinely contains further distinct sub-parts (e.g. a method with " +
          "several distinct techniques within it, a category with several distinct types within it), break THAT down " +
          "further with a Markdown H4 (####) under the H3 -- but only when the H3 itself is substantial enough to " +
          "need it, never as a default.",
        "- Only skip H3s entirely if this section is genuinely a single cohesive idea with nothing to separate -- do " +
          "not force subdivisions that aren't really there just to add structure.",
        "Never write a long, continuous, all-paragraph block for a section that actually covers several distinct " +
          "things -- that is the exact failure this rule exists to prevent. Equally, never add H3s/H4s/lists to a " +
          "section that's genuinely just one idea.",
      ].join("\n");
  }
}

function buildSectionPrompt(request: ContentGenerationRequest): string {
  const outline = request.allHeadings.map((h, i) => `${i + 1}. ${h}`).join("\n");
  const wordCap = validationWordCap();
  const sectionBudget = wordCap ? sectionWordBudget(wordCap, request.allHeadings.length) : null;
  return [
    `You are drafting ONE section of a real article. The article's real, already-decided outline (for your own context -- do not repeat other sections' content):`,
    outline,
    "",
    `Article title: "${request.title}"`,
    `Target keyword: "${request.targetKeyword}"`,
    request.relatedKeywords.length > 0 ? `Related topical keywords (use only where they genuinely fit): ${request.relatedKeywords.join(", ")}` : "",
    `Section you are writing now: "${request.heading}"`,
    brandLine(request.brandGuidelines),
    "",
    roleGuidance(request.sectionRole, request.heading, request.targetKeyword),
    "",
    "General rules for every section:",
    `- ${SHARED_WRITING_RULES}`,
    "",
    "Write ONLY this section's body prose (no heading text, no markdown title, no preamble like 'Here is the section'). " +
      "Let the length genuinely fit what this section needs to say -- don't pad, and don't force a fixed paragraph count.",
    "Before finalizing, silently review your own draft: does it directly serve this reader's search intent, put " +
      "must-know information ahead of advanced detail, stay free of repetition/filler/robotic phrasing, and keep " +
      "every claim grounded in what you were actually given? Fix anything that fails that check before answering -- " +
      "return only the finished prose, never your review notes.",
    sectionBudget
      ? `VALIDATION TEST MODE (temporary, for testing only -- not the normal standard): keep this section to ` +
        `roughly ${sectionBudget} words or fewer (this whole article is capped at about ${wordCap} words for this ` +
        "test run only, to limit API/credit usage). Prioritize the single most important, most beginner-relevant " +
        "point for this section over completeness -- never sacrifice the reader-value or search-intent rules above " +
        "to hit this limit, just be concise."
      : "",
    qaFeedbackBlock(request.qaFeedback),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMetaPrompt(request: MetaGenerationRequest): string {
  const excerpt = request.sections
    .slice(0, 3)
    .map((s) => `${s.heading}: ${s.body.slice(0, 400)}`)
    .join("\n\n");
  return [
    "Write a real meta title and meta description for the article below, based on what it ACTUALLY covers -- never generic boilerplate.",
    `Article title: "${request.title}"`,
    `Target keyword: "${request.targetKeyword}"`,
    `Search intent: ${request.intent}`,
    "",
    "Real excerpt from the article's own drafted content:",
    excerpt,
    "",
    "Rules:",
    "- Meta title: clear, specific, accurately describes the article. Include the target keyword only if it fits naturally -- never keyword-stuff. Never clickbait that misrepresents the content.",
    "- Meta description: a concise, unique summary reflecting search intent, based on the real content above -- not a fixed character-count target treated as a ranking requirement, just genuinely useful and accurate.",
    "- Never invent a claim, statistic, or offer (pricing, guarantees, awards) not present in the real content above.",
    qaFeedbackBlock(request.qaFeedback),
    "",
    'Return ONLY JSON: {"metaTitle": "...", "metaDescription": "..."} -- no other text, no markdown fence.',
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFaqAnswerPrompt(request: FaqAnswerGenerationRequest): string {
  const context = request.sections.map((s) => `${s.heading}: ${s.body}`).join("\n\n");
  return [
    "Answer this one FAQ question concisely and directly, using ONLY the real article content below as your source of facts.",
    `Article title: "${request.title}"`,
    `Target keyword: "${request.targetKeyword}"`,
    `Question: "${request.question}"`,
    "",
    "Real article content (the only material you may draw on):",
    context,
    "",
    "Rules:",
    "- Never invent a fact, statistic, price, or claim not present or directly implied above. If the real content genuinely doesn't answer this question, say so plainly in one short sentence and stop there -- never follow that with a speculative guess, a hedge, or a made-up answer dressed up as fact.",
    "- Keep the answer concise and direct -- a short paragraph, not a full section.",
    "- Do not claim this FAQ will produce a Google rich result.",
    "",
    "Return ONLY the answer text -- no heading, no preamble, no markdown.",
  ].join("\n");
}

function buildFaqQuestionsPrompt(request: FaqQuestionGenerationRequest): string {
  const context = request.sections.map((s) => `${s.heading}: ${s.body}`).join("\n\n");
  return [
    "Write genuinely useful FAQ questions for the real article below -- the kind of specific questions an actual reader " +
      "of THIS article would have, never a generic keyword-templated shape like \"What is X?\" or \"How does X work?\".",
    `Article title: "${request.title}"`,
    `Target keyword: "${request.targetKeyword}"`,
    `Search intent: ${request.intent}`,
    request.relatedKeywords.length > 0 ? `Related keywords: ${request.relatedKeywords.join(", ")}` : "",
    "",
    "Real article content (ground every question in what this article actually covers):",
    context,
    "",
    "Rules:",
    "- Aim for about 4 to 6 questions for a normal article with enough genuine follow-up questions -- but never pad to hit that count, and never fewer than 3 if the topic genuinely supports that many.",
    "- Each question must be specific and answerable from the real content above (or a closely related, genuinely common follow-up), never a restatement of the title as a question, and never a restatement of one of the article's own H2 headings as a question.",
    "- Only include a question you can verify is genuinely answerable from the real content above -- never include a common question for this topic if this specific article doesn't actually cover it; a strong, answerable question beats a generic, unanswerable one.",
    "- If you're revising because earlier questions were too repetitive of the article's other sections, do not fix that by inventing a new-sounding question the real content doesn't actually cover -- a genuinely useful, answerable question that overlaps somewhat with the article is better than a novel one that isn't actually answerable.",
    "- Do not claim these will produce a Google rich result.",
    qaFeedbackBlock(request.qaFeedback),
    "",
    "Return ONLY a JSON array of question strings -- no other text, no markdown fence.",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderArticleForReview(
  title: string,
  metaTitle: string,
  metaDescription: string,
  sections: readonly { readonly heading: string; readonly body: string }[],
  faqs: readonly { readonly question: string; readonly answer: string }[],
): string {
  // Mirrors the REAL rendering (see web/src/server/backend/content.ts's summarizeSeoContentForChat) --
  // kept identical to anthropic-content-generation-provider.ts's own function; see that file's header
  // for why the Q&A pairs render INLINE under the FAQ heading rather than as a second, separately-
  // labeled "## FAQ" block (a live QA self-check flagged the two-block shape as a broken hierarchy).
  const faqBlock = faqs.length > 0 ? faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n") : "";
  let faqInlined = false;
  const sectionBlocks = sections.map((s) => {
    if (!s.body && faqBlock && !faqInlined) {
      faqInlined = true;
      return `## ${s.heading}\n${faqBlock}`;
    }
    return s.body ? `## ${s.heading}\n${s.body}` : `## ${s.heading}`;
  });
  return [
    `TITLE (H1): ${title}`,
    `META TITLE: ${metaTitle}`,
    `META DESCRIPTION: ${metaDescription}`,
    "",
    ...sectionBlocks,
    !faqInlined && faqBlock ? `\n## FAQ\n${faqBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildQaPrompt(request: ContentQaRequest): string {
  const article = renderArticleForReview(request.title, request.metaTitle, request.metaDescription, request.sections, request.faqs);
  const faqHasContent = request.faqs.length > 0;

  const wordCap = validationWordCap();

  return [
    "You are doing a real, honest editorial QA pass on the article below before it's published. Evaluate it against these checks:",
    "search_intent_satisfied, topic_adequately_covered, h1_present, logical_h2_hierarchy, h3_used_appropriately, " +
      "introduction_useful, keyword_natural, no_keyword_stuffing, semantic_coverage_natural, no_repetitive_filler, " +
      "originality, facts_supported, readability, lists_tables_appropriate, faq_useful, conclusion_useful, " +
      "meta_description_present, people_first, beginner_first_prioritized, progressive_depth_appropriate, " +
      "reader_value_clear, no_unsupported_seo_claims",
    "",
    "Additional check definitions (the rest are self-explanatory):",
    "- beginner_first_prioritized: fails if must-know/beginner-relevant information is buried after advanced or tangential detail, or if lengthy advanced/technical material is included without being necessary to answer the query.",
    "- progressive_depth_appropriate: fails if the article dumps deep/advanced detail on the reader before covering the practical basics, or jumps between depth levels erratically instead of moving beginner -> practical -> deeper naturally.",
    "- reader_value_clear: fails if any meaningful part of the article doesn't help the reader understand something, solve a problem, decide something, or take a next step -- e.g. filler, word-count padding, or restating another section.",
    "- no_unsupported_seo_claims: fails if the article makes an absolute or unqualified ranking/traffic/results claim, or states a technique's effect on search rankings as settled fact rather than appropriately qualified.",
    "",
    `Target keyword: "${request.targetKeyword}"`,
    "",
    `FAQ DECISION (already made upstream, before this article was drafted -- do NOT re-judge topic-appropriateness ` +
      `yourself): an FAQ section is ${request.faqExpected ? "GENUINELY WARRANTED" : "NOT warranted"} for this topic.` +
      (request.faqRationale ? ` Stated reason: "${request.faqRationale}"` : "") +
      ` This article ${faqHasContent ? "DOES include" : "does NOT include"} an FAQ section.`,
    "Evaluate faq_useful STRICTLY against that decision, using exactly these four cases:",
    "- Warranted AND present: passes faq_useful only if the questions are genuinely specific to this article (not generic/templated) and answers are grounded in the real content above -- fail if generic, repetitive, ungrounded, or if an answer hedges (\"the article does not directly answer...\") and then speculates instead of plainly stopping there.",
    "- Warranted AND missing: fails faq_useful -- the article should have one but doesn't.",
    "- NOT warranted AND absent: passes faq_useful -- this is the CORRECT outcome, not a defect. Do not fail this for \"no FAQ section.\"",
    "- NOT warranted BUT present anyway: fails faq_useful -- an FAQ was forced in unnecessarily.",
    "",
    "ARTICLE:",
    article,
    "",
    "Be genuinely critical -- do not pass content that is generic, keyword-stuffed, has fabricated-sounding claims, or reads as filler.",
    wordCap
      ? `NOTE: this run used a temporary validation-mode word cap (~${wordCap} words for the whole article, purely ` +
        "to limit test cost) -- do not fail topic_adequately_covered, progressive_depth_appropriate, or " +
        "reader_value_clear merely because the cap forced brevity; still fail them if the piece fails to serve the " +
        "core search intent within that budget."
      : "",
    'Return ONLY JSON: {"passed": true|false, "failedChecks": ["check_name", ...], "notes": "one or two real, specific sentences"} -- ' +
      "failedChecks must use the exact check names above, empty array if none failed. No other text, no markdown fence.",
  ]
    .filter(Boolean)
    .join("\n");
}

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

export interface GeminiContentGenerationProviderOptions {
  readonly apiKey?: string;
  readonly model?: string;
  /** Shared across every Gemini-backed provider in one process so the whole pipeline paces itself against ONE real quota -- see gemini-rate-limiter.ts. Defaults to a private instance when not supplied (e.g. in tests). */
  readonly rateLimiter?: GeminiRateLimiter;
}

export class GeminiContentGenerationProvider implements ContentGenerationProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI | null;
  private readonly model: string;
  private readonly rateLimiter: GeminiRateLimiter;

  constructor(options: GeminiContentGenerationProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env["GOOGLE_GEMINI_API_KEY"];
    // No `vertexai` option is set -- this deliberately stays on the
    // free-tier-eligible Gemini Developer API path, never Vertex AI.
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.model = options.model ?? process.env["GOOGLE_GEMINI_MODEL"] ?? DEFAULT_MODEL;
    this.rateLimiter = options.rateLimiter ?? new GeminiRateLimiter();
  }

  private async complete(prompt: string, maxOutputTokens: number): Promise<string | null> {
    if (!this.client) return null;
    try {
      const text = await this.rateLimiter.run(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          // thinkingBudget: 0 disables Gemini's own extended-thinking tokens, which
          // otherwise count against maxOutputTokens -- the sibling Anthropic provider
          // hit this exact failure mode live (a long reasoning-heavy prompt consumed
          // the entire token budget on reasoning, leaving none for the actual answer).
          const response = await this.client!.models.generateContent({
            model: this.model,
            contents: prompt,
            config: { maxOutputTokens, abortSignal: controller.signal, thinkingConfig: { thinkingBudget: 0 } },
          });
          return response.text;
        } finally {
          clearTimeout(timeout);
        }
      });
      return text ? text.trim() : null;
    } catch (error) {
      // Never fabricates a fallback -- still returns null -- but logging the real error (never the
      // prompt content or the API key) is what let a real production failure (a rate limit from many
      // concurrent per-section calls) get diagnosed instead of looking identical to "no API key".
      console.error(`[GeminiContentGenerationProvider] API call failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async generateSection(request: ContentGenerationRequest): Promise<GeneratedSection | null> {
    const wordCap = validationWordCap();
    // TEMPORARY VALIDATION-MODE WORD CAP -- kept identical to the sibling Anthropic provider's own
    // logic; see that file's generateSection() for the full rationale. Never applied unless
    // SEO_CONTENT_VALIDATION_MAX_WORDS is explicitly set.
    const maxOutputTokens = wordCap
      ? Math.min(SECTION_MAX_OUTPUT_TOKENS, sectionWordBudget(wordCap, request.allHeadings.length) * 4 + 80)
      : SECTION_MAX_OUTPUT_TOKENS;
    const text = await this.complete(buildSectionPrompt(request), maxOutputTokens);
    return text ? { heading: request.heading, body: text } : null;
  }

  async generateMetaContent(request: MetaGenerationRequest): Promise<GeneratedMetaContent | null> {
    const text = await this.complete(buildMetaPrompt(request), META_MAX_OUTPUT_TOKENS);
    if (!text) return null;
    try {
      const parsed = JSON.parse(stripFence(text)) as { metaTitle?: unknown; metaDescription?: unknown };
      if (typeof parsed.metaTitle !== "string" || typeof parsed.metaDescription !== "string" || !parsed.metaTitle.trim() || !parsed.metaDescription.trim()) {
        return null;
      }
      return { metaTitle: parsed.metaTitle.trim(), metaDescription: parsed.metaDescription.trim() };
    } catch {
      return null;
    }
  }

  async generateFaqAnswer(request: FaqAnswerGenerationRequest): Promise<string | null> {
    return this.complete(buildFaqAnswerPrompt(request), FAQ_ANSWER_MAX_OUTPUT_TOKENS);
  }

  async generateFaqQuestions(request: FaqQuestionGenerationRequest): Promise<readonly string[] | null> {
    const text = await this.complete(buildFaqQuestionsPrompt(request), FAQ_QUESTIONS_MAX_OUTPUT_TOKENS);
    if (!text) return null;
    try {
      const parsed = JSON.parse(stripFence(text)) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string" && item.trim().length > 0)) {
        return null;
      }
      return parsed.map((q) => q.trim());
    } catch {
      return null;
    }
  }

  async evaluateContent(request: ContentQaRequest): Promise<ContentQaVerdict | null> {
    const text = await this.complete(buildQaPrompt(request), QA_MAX_OUTPUT_TOKENS);
    if (!text) return null;
    try {
      const parsed = JSON.parse(stripFence(text)) as { passed?: unknown; failedChecks?: unknown; notes?: unknown };
      if (typeof parsed.passed !== "boolean" || !Array.isArray(parsed.failedChecks) || typeof parsed.notes !== "string") {
        return null;
      }
      const failedChecks = parsed.failedChecks.filter((c): c is string => typeof c === "string");
      return { passed: parsed.passed, failedChecks, notes: parsed.notes };
    } catch {
      return null;
    }
  }
}
