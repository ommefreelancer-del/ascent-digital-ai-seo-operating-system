// Derives real, article-grounded visual search concepts for the Content
// Generation image-selection pipeline (see content-images.ts). Before this
// existed, content-images.ts searched Pixabay using only a section's own
// heading plus the article's target keyword, and simply attached an image to
// the first few sections long enough to qualify -- a live review of selected
// images found this drove image count off "how many sections happen to be
// long enough" rather than off what the article actually needed pictured,
// and had no notion of "this must look like real-life photography" versus an
// icon, illustration, or 3D render.
//
// This module ONLY produces search-query TEXT (a real Pixabay `q` string
// plus which real section heading it best supports) -- it never invents
// Pixabay metadata, ids, or URLs; content-images.ts's own real
// searchImages()/downloadAndStoreAsset() calls remain the only source of
// truth for what images actually exist and get attached.
//
// Real AI-driven concept derivation (via the same ANTHROPIC_API_KEY/model
// convention specialist-ai.ts and web-development.ts already use) is the
// primary path when configured -- it reads the article's OWN real title and
// drafted section bodies (never invents a new subtopic) and identifies
// genuine visual opportunities: practical situations, real objects,
// environments, and actions actually described. With no key configured, or
// the real call unavailable/failing, deriveImageConcepts falls back to a
// deterministic, disclosed heuristic (one concept per qualifying section,
// built only from that section's own real heading and the target keyword)
// -- never fabricated, just less semantically aware than a real model
// reading the actual prose.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { GeminiRateLimiter } from "./gemini-rate-limiter";
import type { ContentPieceDraft, ContentSectionDraft } from "./types";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const MAX_TOKENS = 900; // headroom for the added alternateQuery field per concept
// LIVE VALIDATION FIX (2026-08-31): matches the identical timeout bump in gemini-content-generation-
// provider.ts -- a live run showed real Gemini-side slowness/overload cutting off calls at 30s.
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;
// Shared by every Gemini call this module makes (concept derivation + relevance judgment can both fire
// several times per article) so they pace against the SAME real free-tier quota -- see
// gemini-rate-limiter.ts. A separate instance from content.ts's own (agent-layer) rate limiter: image
// concept derivation always runs strictly after all section body generation finishes (attachSupportingImages
// is called once developContent() has already resolved), so the two never race for the same quota window.
const geminiRateLimiter = new GeminiRateLimiter();

/**
 * True only for an error shape that genuinely indicates the ACCOUNT can't be billed/authorized right
 * now (exhausted credits, revoked key, no plan access) -- never a rate limit, bad prompt, or transient
 * failure. Intentionally duplicated from src/agents/seo-content-agent/providers/
 * provider-billing-unavailable-error.ts's identical function: this web-layer module calls
 * @anthropic-ai/sdk/@google/genai directly (the same pattern specialist-ai.ts uses) rather than going
 * through the SeoContentAgent provider seam, and cannot statically import agent-layer TypeScript source
 * -- see content.ts's own header for why every cross-layer agent import in this codebase instead goes
 * through a dynamic dist/src import.
 */
function isBillingOrAccessFailure(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /credit balance is too low|insufficient_quota|billing/i.test(message);
}
// CONTENT REQUIREMENT (2026-09-01): every long-form article should carry 3-4 real images, never
// forced -- narrowed from the prior 3-5 ceiling so the concept-derivation target matches that exactly
// (still "prefer", still "never pad to hit a count" -- see the prompt rule below).
const MIN_CONCEPTS = 3;
const MAX_CONCEPTS = 4;
const MIN_BODY_LENGTH_FOR_CONCEPT = 200;
const SECTION_EXCERPT_LENGTH = 500;

export interface ImageConcept {
  /** A real-life-photography-oriented Pixabay search query (2-6 words) -- never a description of an icon/illustration/3D render. */
  readonly query: string;
  /**
   * A genuinely different phrasing of the SAME visual concept (different wording/framing, not a
   * subset or truncation of `query`) -- used only if the first search finds nothing suitable, per
   * "use semantically related photographic concepts rather than repeatedly searching the same
   * phrase." Absent when the model (or the deterministic fallback) has no real alternative to offer.
   */
  readonly alternateQuery?: string;
  /** The exact real section heading (from the article's own outline) this image is meant to support. */
  readonly targetHeading: string;
  /** One real, specific reason this image helps THIS article -- for audit/QA, never shown to the reader. */
  readonly rationale: string;
}

export interface ImageConceptResult {
  readonly concepts: readonly ImageConcept[];
  /** "ai" when a real model supplied these from the article's own content; "heuristic" when it fell back to the deterministic, disclosed per-section template. */
  readonly source: "ai" | "heuristic";
}

function qualifyingSections(draft: ContentPieceDraft): readonly ContentSectionDraft[] {
  return draft.sections.filter((s) => s.isGenerated && s.body.trim().length >= MIN_BODY_LENGTH_FOR_CONCEPT);
}

function buildPrompt(draft: ContentPieceDraft, sections: readonly ContentSectionDraft[]): string {
  const excerpt = sections.map((s) => `### ${s.heading}\n${s.body.slice(0, SECTION_EXCERPT_LENGTH)}`).join("\n\n");
  return [
    "You are choosing what REAL-LIFE PHOTOGRAPHS (from a stock photo library) would genuinely help a reader of the " +
      "article below -- never icons, illustrations, 3D renders, clipart, or abstract graphics.",
    "",
    `Article title: "${draft.title}"`,
    `Target keyword: "${draft.targetKeyword}"`,
    "",
    "Real article content (the only material to draw on -- never invent a topic, scenario, or detail not actually here):",
    excerpt,
    "",
    "Task: identify the genuine visual opportunities in THIS article -- concrete practical situations, real " +
      "people/actions/objects/environments actually described or clearly implied by a section. Do not force one " +
      "per section; a section with nothing concretely visual gets none.",
    "Rules:",
    `- Prefer ${MIN_CONCEPTS}-${MAX_CONCEPTS} concepts for a normal full-length article with enough real visual material -- ` +
      "but return fewer (even zero) if the article genuinely doesn't have that many distinct visual opportunities. Never pad to hit a count.",
    "- Each concept's query must describe a real-life photography scene (real people, real environments, real " +
      "objects, real everyday activities) -- something that could actually have been photographed. Never describe " +
      "a diagram, icon, logo, illustration, or abstract concept.",
    "- Each concept must be genuinely different from the others -- different subjects, different real situations -- not the same scene restated.",
    "- Each concept must tie to one specific real heading from the article above (use the EXACT heading text) -- the section it would visually support.",
    // PROMPT REVIEW FIX (2026-09-06): a real, live-observed defect -- independent real generations for the
    // SAME topic (digital marketing / content-writing subject matter) both converged on a generic "person
    // typing on a laptop" concept, which Pexels then matched to the exact same extremely common, generic
    // stock photo across separate, unrelated articles. Root cause identified in this prompt itself: (1) the
    // example query list below used to include "laptop screen outdoors sunlight" -- a generic office/tech
    // scene offered as a GOOD example, which any digital/writing-related topic (guest posting, SEO, content
    // marketing, etc.) can trivially "satisfy" without saying anything specific about that article; (2) no
    // rule discouraged that exact cliché as a default filler when a more specific scene was available. This
    // is a concrete, identified problem, not a prompt-wording guess -- the fix is the new explicit rule
    // below plus swapping that one example for a domain-varied one, not a rewrite of the whole prompt.
    "- Avoid defaulting to a generic \"person typing on a laptop\" / \"person using a computer\" scene merely because the " +
      "article's topic involves writing, content, marketing, or digital work -- this is an overused stock-photo cliché " +
      "that countless unrelated articles could equally use, which defeats the goal of genuinely topic-specific imagery. " +
      "Only propose one if a section's own content specifically centers on the physical act of typing/writing itself " +
      "(e.g., a step literally about drafting the piece); otherwise find a scene tied to what THIS article's own real " +
      "content actually describes (a specific action, object, environment, or interaction named in the text).",
    '- Query text: 2-6 words, written the way you\'d search a stock photo site (e.g. "person cleaning carpet stain", ' +
      '"farmers market vendor arranging produce", "plumber fixing pipe under sink") -- concrete and specific, never the bare target keyword alone.',
    '- Also give each concept a real "alternateQuery": a genuinely DIFFERENT phrasing or framing of the same real-life ' +
      "scene (a different angle, action, or way a photographer might have shot it) -- not just fewer words from the " +
      "same query. This is used only if the first search finds nothing suitable, so the retry searches a real " +
      "semantic variation instead of the same phrase again. Omit it only if you genuinely can't think of a distinct alternative.",
    "",
    'Return ONLY JSON: {"concepts": [{"query": "...", "alternateQuery": "...", "targetHeading": "...", "rationale": "..."}]} ' +
      "-- no other text, no markdown fence. Empty array if genuinely nothing here is a real visual opportunity.",
  ].join("\n");
}

function parseConcepts(text: string, headings: ReadonlySet<string>): ImageConcept[] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { concepts?: unknown }).concepts)) {
    return null;
  }

  const concepts: ImageConcept[] = [];
  const seenQueries = new Set<string>();
  for (const item of (parsed as { concepts: unknown[] }).concepts) {
    if (typeof item !== "object" || item === null) continue;
    const { query, alternateQuery, targetHeading, rationale } = item as {
      query?: unknown;
      alternateQuery?: unknown;
      targetHeading?: unknown;
      rationale?: unknown;
    };
    if (typeof query !== "string" || !query.trim()) continue;
    if (typeof targetHeading !== "string" || !headings.has(targetHeading)) continue;
    if (typeof rationale !== "string" || !rationale.trim()) continue;

    const normalizedQuery = query.trim().toLowerCase();
    if (seenQueries.has(normalizedQuery)) continue; // never the same concept twice
    seenQueries.add(normalizedQuery);

    const hasRealAlternate = typeof alternateQuery === "string" && alternateQuery.trim().length > 0 && alternateQuery.trim().toLowerCase() !== normalizedQuery;
    concepts.push({
      query: query.trim(),
      ...(hasRealAlternate ? { alternateQuery: (alternateQuery as string).trim() } : {}),
      targetHeading,
      rationale: rationale.trim(),
    });
    if (concepts.length >= MAX_CONCEPTS) break;
  }
  return concepts;
}

/** Distinguishes "no real result" from "specifically a billing/access failure" so the caller knows whether trying Gemini next is warranted, without changing either public function's own `| null` return contract. */
interface AiOutcome<T> {
  readonly value: T | null;
  readonly billingFailure: boolean;
}

async function deriveConceptsWithAnthropic(draft: ContentPieceDraft, sections: readonly ContentSectionDraft[]): Promise<AiOutcome<ImageConcept[]>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { value: null, billingFailure: false };

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const headings = new Set(sections.map((s) => s.heading));

  try {
    // thinking disabled: claude-sonnet-5's own adaptive-thinking tokens count against max_tokens and
    // can silently consume the whole budget on a reasoning-heavy prompt, leaving no room for the
    // actual JSON answer -- the same failure mode the seo-content-agent providers hit and fixed live.
    const message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: buildPrompt(draft, sections) }],
    });
    const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
    if (!text) return { value: null, billingFailure: false };
    const concepts = parseConcepts(text, headings);
    if (concepts) {
      console.log(
        `[image-concepts] derived ${concepts.length} concept(s) via anthropic: ${concepts
          .map((c) => `"${c.query}"${c.alternateQuery ? ` (alt: "${c.alternateQuery}")` : ""} -> "${c.targetHeading}"`)
          .join("; ")}`,
      );
    }
    return { value: concepts, billingFailure: false };
  } catch (error) {
    console.error(`[image-concepts] Anthropic call failed: ${error instanceof Error ? error.message : String(error)}`);
    return { value: null, billingFailure: isBillingOrAccessFailure(error) };
  }
}

/**
 * Gemini equivalent of deriveConceptsWithAnthropic, used ONLY as a fallback when Anthropic fails
 * specifically due to a billing/credit/access failure -- reuses the exact same prompt/parsing logic, so
 * a topic answered by Gemini gets the same real, article-grounded concepts as one answered by Anthropic.
 */
async function deriveConceptsWithGemini(draft: ContentPieceDraft, sections: readonly ContentSectionDraft[]): Promise<ImageConcept[] | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GOOGLE_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenAI({ apiKey });
  const headings = new Set(sections.map((s) => s.heading));

  try {
    const text = await geminiRateLimiter.run(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
      try {
        const response = await client.models.generateContent({
          model,
          contents: buildPrompt(draft, sections),
          config: { maxOutputTokens: MAX_TOKENS, abortSignal: controller.signal, thinkingConfig: { thinkingBudget: 0 } },
        });
        return response.text;
      } finally {
        clearTimeout(timeout);
      }
    });
    if (!text) return null;
    const concepts = parseConcepts(text, headings);
    if (concepts) {
      console.log(
        `[image-concepts] derived ${concepts.length} concept(s) via gemini fallback: ${concepts
          .map((c) => `"${c.query}"${c.alternateQuery ? ` (alt: "${c.alternateQuery}")` : ""} -> "${c.targetHeading}"`)
          .join("; ")}`,
      );
    }
    return concepts;
  } catch (error) {
    console.error(`[image-concepts] Gemini call failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export interface RelevanceCandidate {
  readonly id: number;
  readonly tags: readonly string[];
}

function buildRelevancePrompt(concept: ImageConcept, candidates: readonly RelevanceCandidate[]): string {
  const listing = candidates.map((c) => `- id ${c.id}: tags = ${c.tags.join(", ")}`).join("\n");
  return [
    "A real-life photography search was run for the visual concept below, and these are the actual candidate " +
      "results (id + real tags) it returned. Judge whether ANY of them genuinely, specifically depict this exact " +
      "scene -- sharing one incidental word in the tags is NOT enough; the subject must actually match.",
    "",
    `Visual concept: "${concept.query}"`,
    `Why this image is wanted: ${concept.rationale}`,
    `Article section it would support: "${concept.targetHeading}"`,
    "",
    "Candidates:",
    listing,
    "",
    "Rules:",
    "- Pick the id of the ONE candidate that most specifically and genuinely matches the visual concept -- not just a loosely related or coincidentally tagged photo.",
    '- If NONE of them genuinely depict this specific concept, say so honestly -- return null. A weak or tangential match is worse than no image at all.',
    "",
    'Return ONLY JSON: {"bestId": <id-number-or-null>, "reason": "one short, specific sentence"} -- no other text, no markdown fence.',
  ].join("\n");
}

/** Whether a real relevance judgment (pickMostRelevantCandidate) is actually available -- lets a caller distinguish "no real judgment could be made, fall back to a stricter deterministic rule" from "a real judgment was made and it rejected every candidate," which must NOT fall back to anything weaker. True when EITHER real provider is configured, since pickMostRelevantCandidate itself now tries both. */
export function isAiRelevanceCheckAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(process.env.GOOGLE_GEMINI_API_KEY);
}

function parseRelevanceResponse(text: string, validIds: ReadonlySet<number>, concept: ImageConcept, candidateCount: number): number | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(trimmed) as { bestId?: unknown; reason?: unknown };
  const reason = typeof parsed.reason === "string" ? parsed.reason : "(no reason given)";
  console.log(`[image-concepts] relevance check for "${concept.query}" (${candidateCount} candidate(s)): bestId=${JSON.stringify(parsed.bestId)} -- ${reason}`);
  if (parsed.bestId === null || parsed.bestId === undefined) return null;
  if (typeof parsed.bestId !== "number" || !validIds.has(parsed.bestId)) return null;
  return parsed.bestId;
}

async function pickMostRelevantCandidateWithAnthropic(concept: ImageConcept, candidates: readonly RelevanceCandidate[]): Promise<AiOutcome<number>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { value: null, billingFailure: false };

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const validIds = new Set(candidates.map((c) => c.id));

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 300,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: buildRelevancePrompt(concept, candidates) }],
    });
    const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
    if (!text) return { value: null, billingFailure: false };
    return { value: parseRelevanceResponse(text, validIds, concept, candidates.length), billingFailure: false };
  } catch (error) {
    console.error(`[image-concepts] Relevance-check Anthropic call failed: ${error instanceof Error ? error.message : String(error)}`);
    return { value: null, billingFailure: isBillingOrAccessFailure(error) };
  }
}

/** Gemini equivalent of pickMostRelevantCandidateWithAnthropic, used ONLY as a fallback on an Anthropic billing/access failure -- identical prompt/parsing logic. */
async function pickMostRelevantCandidateWithGemini(concept: ImageConcept, candidates: readonly RelevanceCandidate[]): Promise<number | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GOOGLE_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const client = new GoogleGenAI({ apiKey });
  const validIds = new Set(candidates.map((c) => c.id));

  try {
    const text = await geminiRateLimiter.run(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
      try {
        const response = await client.models.generateContent({
          model,
          contents: buildRelevancePrompt(concept, candidates),
          config: { maxOutputTokens: 300, abortSignal: controller.signal, thinkingConfig: { thinkingBudget: 0 } },
        });
        return response.text;
      } finally {
        clearTimeout(timeout);
      }
    });
    if (!text) return null;
    return parseRelevanceResponse(text, validIds, concept, candidates.length);
  } catch (error) {
    console.error(`[image-concepts] Relevance-check Gemini call failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Real, LLM-judged relevance check: given a visual concept and a short list of real Pixabay candidates
 * (only their ids and real tags -- never image bytes), picks which single candidate (if any) genuinely,
 * specifically depicts that concept -- never just "shares a word," which is what let a candidate like a
 * "tactical flashlight" photo get selected for a concept about finding steel grain direction on a live
 * run (both happened to share no real subject, only an incidental tag). Tries Anthropic first; on a
 * genuine billing/credit/access failure specifically, retries the SAME judgment against Gemini. Returns
 * `null` when both are unavailable/fail, or when a real judgment ran and honestly rejected every
 * candidate -- the caller must never fall back to a weaker match just because this returned nothing;
 * "no image" is the correct, honest outcome in every case.
 */
export async function pickMostRelevantCandidate(concept: ImageConcept, candidates: readonly RelevanceCandidate[]): Promise<number | null> {
  if (candidates.length === 0) return null;

  const anthropicOutcome = await pickMostRelevantCandidateWithAnthropic(concept, candidates);
  if (anthropicOutcome.value !== null) return anthropicOutcome.value;
  if (!anthropicOutcome.billingFailure) return null;

  return pickMostRelevantCandidateWithGemini(concept, candidates);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "how",
  "your", "you", "can", "this", "that", "is", "are", "into", "from", "their",
]);

function significantWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

/**
 * Deterministically picks up to `count` items evenly spread across the full list -- e.g. 4 of 9 picks
 * indices 0, 2, 4, 6/8 rather than always the first 4. Used so the no-AI heuristic fallback's images
 * land throughout the article instead of clustering on whichever sections happen to qualify first.
 */
function evenlySpaced<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const picked: T[] = [];
  const stride = items.length / count;
  for (let i = 0; i < count; i++) {
    picked.push(items[Math.floor(i * stride)]!);
  }
  return picked;
}

/**
 * The honest, disclosed fallback when no real AI concept provider is
 * available -- one concept per qualifying section, built only from that
 * section's own real heading and the article's real target keyword. Never
 * fabricated, just less semantically aware than a real model reading the
 * actual prose. Sections are sampled evenly across the article (see
 * evenlySpaced) rather than always the first few, so placement is
 * distributed the same way the real AI-derived path already achieves by
 * reading the whole article.
 */
function heuristicConcepts(draft: ContentPieceDraft, sections: readonly ContentSectionDraft[]): ImageConcept[] {
  return evenlySpaced(sections, MAX_CONCEPTS)
    .map((section) => {
      const words = Array.from(new Set([...significantWords(draft.targetKeyword), ...significantWords(section.heading)])).slice(0, 5);
      return {
        query: words.join(" "),
        targetHeading: section.heading,
        rationale:
          "Deterministic fallback: no real image-concept provider was available, so this concept is built directly from the section's own heading and the article's target keyword.",
      };
    })
    .filter((concept) => concept.query.trim().length > 0);
}

/**
 * Real, article-grounded visual search concepts for the given content draft. Tries a real
 * Anthropic-backed derivation first (when ANTHROPIC_API_KEY is configured); on a genuine billing/
 * credit/access failure specifically, retries the SAME derivation against Gemini (when
 * GOOGLE_GEMINI_API_KEY is configured). Falls back to the deterministic heuristic above only when both
 * are unavailable or fail. Never fabricates a concept beyond what the article's own real content
 * supports.
 */
export async function deriveImageConcepts(draft: ContentPieceDraft): Promise<ImageConceptResult> {
  const sections = qualifyingSections(draft);
  if (sections.length === 0) {
    return { concepts: [], source: "heuristic" };
  }

  const anthropicOutcome = await deriveConceptsWithAnthropic(draft, sections);
  if (anthropicOutcome.value) {
    return { concepts: anthropicOutcome.value, source: "ai" };
  }

  if (anthropicOutcome.billingFailure) {
    const geminiConcepts = await deriveConceptsWithGemini(draft, sections);
    if (geminiConcepts) {
      return { concepts: geminiConcepts, source: "ai" };
    }
  }

  return { concepts: heuristicConcepts(draft, sections), source: "heuristic" };
}
