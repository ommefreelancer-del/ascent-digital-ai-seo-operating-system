// Wires the Pexels service (server/pexels.ts) into the SEO Content Agent's
// real content-generation execution path (content.ts's generateContent()/
// researchKeywordsAndGenerateContentFromMessage()). Nothing here talks to
// api.pexels.com directly -- this module only calls pexels.ts's own
// searchImages()/downloadAndStoreAsset().
//
// REPLACED PIXABAY (2026-09-01): this pipeline used server/pixabay.ts until
// a live validation found it returning 0 genuinely relevant photographic
// matches across several real article-grounded concepts -- every candidate
// was rejected as wrong-subject, non-photographic, or a near-duplicate (see
// project notes). Pexels' curated, photography-only catalog was chosen as
// the replacement primary source. This is UNRELATED to the separate Graphic
// Design Agent Pixabay asset browser (backend/graphic-design.ts,
// /api/assets/pixabay/*), which is untouched and still uses
// server/pixabay.ts/PIXABAY_API_KEY.
//
// Never fabricates: a section is only ever attached a REAL Pexels search
// hit that this process actually downloaded a local copy of. Not configured,
// rate-limited, zero results, or no relevant/authentic result -- in every
// case the section is honestly left with no image, never a placeholder
// standing in for a real one.
//
// IMAGE SELECTION HARDENING (2026-08-29): a live review of selected images
// found the previous version picking images off "which sections happen to
// be long enough" rather than what the article actually needed pictured,
// with no filter against illustrations/3D renders/icons and no real
// diversity check beyond avoiding the exact same search-provider id twice.
// This rewrite: (1) derives real, article-grounded visual CONCEPTS first
// (see image-concepts.ts) instead of one generic per-section keyword query,
// (2) applies a tag-based blocklist as defense-in-depth against
// photo-realistic renders or illustrations slipping into results, (3)
// rejects a candidate whose tags overlap too heavily
// with an already-selected image's tags (a real-signal proxy for "this is
// basically the same photo" when no perceptual image hash is available),
// and (4) places each image against the specific section its concept named,
// instead of stacking images onto the first few sections in outline order.
//
// RELEVANCE HARDENING (2026-08-29, same day, live-verification finding): the
// FIRST version of this rewrite still accepted a candidate whenever ANY
// single significant word overlapped between the concept query and the
// hit's tags -- on a real live run this selected a tactical-flashlight photo
// for a concept about finding a steel grain direction, and a wood-grain
// signpost for a step-by-step cleaning concept, both purely because "grain"
// (a generic, polysemous word) happened to appear in both. A real relevance
// JUDGMENT (pickMostRelevantCandidate in image-concepts.ts) now decides
// among the word-overlap-prefiltered candidates when a real provider is
// configured; a real match requires majority word overlap, not a single
// incidental one, when no provider is available. See findCandidateForConcept.

import { searchImages, downloadAndStoreAsset, type NormalizedPexelsAsset } from "@/server/pexels";
import { deriveImageConcepts, isAiRelevanceCheckAvailable, pickMostRelevantCandidate, type ImageConcept } from "./image-concepts";
import type { ArticlePurityIssue, ContentPieceDraft, ContentSectionDraft, ContentSectionImage, ImageRecommendation, SeoContentResult } from "./types";

// A safety cap on outbound search query length -- not a documented Pexels API limit, just a sane
// bound so a very long concept query never gets sent as-is.
const MAX_QUERY_LENGTH = 100;
const CANDIDATES_PER_QUERY = 15;
// A quality floor, honestly enforced by pexels.ts against each hit's REAL reported dimensions --
// large enough that a genuinely low-resolution, throwaway upload is unlikely to pass, per REQUIRED
// IMAGE STRATEGY #10 ("good resolution").
const MIN_IMAGE_WIDTH = 640;
const MIN_IMAGE_HEIGHT = 400;
// Two images whose tag sets overlap this much or more are treated as the same real-world scene
// (near-duplicate), never as two genuinely different photographs -- see REQUIRED IMAGE STRATEGY #5/#6.
const NEAR_DUPLICATE_TAG_OVERLAP = 0.7;

// Real, observable signals (derived from Pexels' own real `alt` text -- see pexels.ts's tagsFromAlt)
// that a hit is not authentic real-life photography -- defense-in-depth on top of Pexels' own
// photography-only catalog curation, in case a photo-realistic render or decorative/generic graphic
// is mislabeled or a contributor's alt text names it. See REQUIRED IMAGE STRATEGY #3/#4.
const NON_PHOTOGRAPHIC_TAG_MARKERS = [
  "3d", "3d render", "3d rendering", "3d model", "cgi", "render", "rendering",
  "illustration", "illustrated", "vector", "clip art", "clipart", "icon", "icons",
  "cartoon", "animated", "animation", "emoji", "emoticon", "logo", "drawing",
  "sketch", "artwork", "digital art", "graphic design", "infographic", "symbol",
  "silhouette", "wireframe", "mockup", "template", "poster design", "flat design",
  "isometric",
];

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "how",
  "your", "you", "can", "this", "that", "is", "are", "into", "from", "their",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

function truncateQuery(query: string): string {
  if (query.length <= MAX_QUERY_LENGTH) return query;
  const words = query.split(/\s+/);
  let truncated = "";
  for (const word of words) {
    const candidate = truncated ? `${truncated} ${word}` : word;
    if (candidate.length > MAX_QUERY_LENGTH) break;
    truncated = candidate;
  }
  return truncated;
}

function isNonPhotographic(hit: NormalizedPexelsAsset): boolean {
  const tagText = hit.tags.join(" ").toLowerCase();
  return NON_PHOTOGRAPHIC_TAG_MARKERS.some((marker) => tagText.includes(marker));
}

// REAL, LIVE-OBSERVED DEFECT (2026-09-07): TWO SEPARATE real generations for "what is guest posting"
// (a topic with no inherent connection to typing/laptops beyond "it's a digital marketing activity")
// both independently attached the SAME kind of generic "person typing on a laptop" stock photo (Pexels
// ids 2267748 and, on a later run, 261662) -- confirmed via each photo's own real tags being drawn
// ENTIRELY from generic office/computer vocabulary, nothing specific to the actual article topic. A real,
// already-existing AI relevance judgment (pickMostRelevantCandidate) approved both matches as genuinely
// depicting their concept -- technically true ("yes, this shows someone typing"), but not a meaningfully
// topic-specific image. This is a deterministic, zero-cost, defense-in-depth backstop -- never a
// fabricated relevance SCORE, just the same real-tag-inspection pattern isNonPhotographic() above already
// uses: if a candidate's ENTIRE tag set is drawn from this generic vocabulary (nothing else), it is
// rejected regardless of what the AI judge said, and the concept is honestly recorded as unfulfilled
// (see processDraft()'s imageRecommendations) rather than silently accepted. Deliberately conservative --
// only rejects when EVERY tag is generic (a photo with even one additional specific tag survives), so a
// genuinely relevant "hands typing" photo for an article actually about typing/keyboarding is not
// wrongly rejected.
// REAL, LIVE-OBSERVED DEFECT FIX (2026-09-08): a FURTHER real generation attached a "latin american lady
// shooting vlog on phone with ring light" photo (tags: confident/young/hispanic) for "Types of Guest
// Posting Opportunities" and a "person shopping online" photo (tags: person/browsing/online) for "How to
// Find and Pitch Guest Posting Sites" -- neither caught by the original office/laptop vocabulary above,
// since these are a DIFFERENT flavor of generic stock photography: demographic/lifestyle portrait
// descriptors and generic "browsing the internet" vocabulary, not office equipment. Same conservative
// mechanism, same rule (every tag must be generic) -- just a wider vocabulary. A candidate combining one
// of these with a genuinely specific, on-topic tag still survives, exactly as before.
const GENERIC_SCENE_TAG_MARKERS = new Set([
  "laptop", "laptops", "typing", "type", "keyboard", "keyboards", "desk", "desks", "office", "offices",
  "computer", "computers", "screen", "screens", "hand", "hands", "using", "use", "work", "working",
  "person", "people", "man", "men", "woman", "women", "technology", "tech", "business", "workspace",
  "indoors", "table", "notebook", "device", "monitor",
  "confident", "young", "old", "adult", "adults", "casual", "smiling", "smile", "happy", "attractive",
  "model", "portrait", "lifestyle", "hispanic", "caucasian", "asian", "african", "latina", "latino",
  "browsing", "online", "shopping", "scrolling", "mobile", "phone", "phones", "smartphone",
  "vlog", "vlogging", "influencer", "selfie", "ring", "content", "creator",
]);

/** Every real tag on this hit is drawn from generic office/computer vocabulary, with nothing else -- see GENERIC_SCENE_TAG_MARKERS's own header for the real defect this closes. */
function isGenericScene(hit: NormalizedPexelsAsset): boolean {
  const tags = hit.tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (tags.length === 0) return false;
  return tags.every((tag) => tag.split(/\s+/).every((word) => GENERIC_SCENE_TAG_MARKERS.has(word)));
}

/**
 * How many of the concept's own significant words actually appear as WHOLE words in this hit's real
 * tags -- exact token matching, never substring matching (a naive `.includes()` check would count
 * "finding" as a match inside "wayfinding", or "grain" inside "grainy", inflating relevance for
 * unrelated photos). A single incidental match is still not treated as relevance on its own; see
 * wordOverlapPasses().
 */
function wordOverlapCount(hit: NormalizedPexelsAsset, queryWords: readonly string[]): number {
  const tagTokens = new Set(hit.tags.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return queryWords.filter((word) => tagTokens.has(word)).length;
}

/**
 * The deterministic, no-AI-available relevance bar: a real match requires the MAJORITY of the
 * concept's significant words to appear in the hit's tags (at least 2 when the query has 2+ words),
 * never just one incidental shared word -- a live run without this found a tactical-flashlight photo
 * and a wood-grain signpost both passed a single-word-overlap check purely because "grain" appeared in
 * both, despite having nothing to do with the actual concept.
 */
function wordOverlapPasses(overlap: number, queryWordCount: number): boolean {
  if (queryWordCount <= 1) return overlap >= 1;
  return overlap >= Math.max(2, Math.ceil(queryWordCount / 2));
}

/** Jaccard similarity of two tag sets -- a real-signal proxy for "this is essentially the same photograph" (a recolor, crop, or near-identical shot from the same shoot), since Pexels' API exposes no perceptual image hash to compare actual pixels. */
function tagOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function isNearDuplicate(hit: NormalizedPexelsAsset, selectedTagSets: readonly (readonly string[])[]): boolean {
  return selectedTagSets.some((tags) => tagOverlap(hit.tags, tags) >= NEAR_DUPLICATE_TAG_OVERLAP);
}

interface CandidateSearchOutcome {
  readonly hit: NormalizedPexelsAsset | null;
  readonly rejectedCount: number;
}

// How many word-overlap-prefiltered candidates get sent to the real relevance judgment call per
// concept -- bounded so the prompt (and its cost) stays small regardless of how many hits Pexels returns.
const MAX_CANDIDATES_FOR_RELEVANCE_CHECK = 6;

/**
 * Runs one concept's real Pexels search and picks the single candidate that both a word-overlap
 * prefilter AND a real relevance judgment (or, with no real judgment available, a stricter
 * majority-word-overlap rule) agree genuinely depicts the concept -- never the first hit that merely
 * shares an incidental word. Photographic-type filtering, "already used", and near-duplicate checks are
 * applied before any relevance judgment runs. If nothing in the first page's prefiltered pool survives,
 * retries with the concept's own real `alternateQuery` when one was supplied -- a genuinely different
 * phrasing/framing of the same visual concept, not just a shorter version of the same words, per "use
 * semantically related photographic concepts rather than repeatedly searching the same phrase." Only
 * when no alternate concept exists does it fall back to a shorter, broader version of the same query,
 * before honestly giving up on this concept.
 *
 * ZERO-IMAGES ROOT CAUSE FIX (2026-09-01): the word-overlap prefilter (requiring at least one EXACT
 * significant-word match between the concept's own query and a hit's tags) was calibrated for
 * Pixabay's dense, multi-word contributor tag lists. Pexels has no such field -- its only text signal
 * is a short, human-written `alt` caption normalized into `tags` (see pexels.ts's tagsFromAlt) -- so a
 * real, specific AI-derived query ("wiping down single-serve pod coffee machine") and a genuinely
 * relevant real photo's own alt-derived tags ("tidy espresso maker countertop") can easily share ZERO
 * exact words despite depicting the same real thing. A live run confirmed this: a well-structured
 * article with genuinely good AI-derived concepts still ended up with zero images end to end, because
 * every candidate was silently dropped by this prefilter before the real AI relevance judgment ever
 * saw it. Fix: when a real AI judgment is available, a query attempt with zero word-overlap hits now
 * still sends its (non-photographic/duplicate/already-used-filtered) raw candidates to that SAME real
 * judgment instead of discarding them -- the AI remains the one honest arbiter of "does this actually
 * depict the concept", so a genuinely irrelevant photo is still rejected exactly as before. The
 * deterministic no-AI-available fallback below is UNCHANGED -- it still requires real majority word
 * overlap, since without a real judge, textual overlap is the only signal this codebase can trust.
 */
async function findCandidateForConcept(
  concept: ImageConcept,
  usedIds: ReadonlySet<number>,
  selectedTagSets: readonly (readonly string[])[],
): Promise<CandidateSearchOutcome> {
  const primaryQuery = truncateQuery(concept.query);
  const alternateQuery = concept.alternateQuery ? truncateQuery(concept.alternateQuery) : null;
  const primaryWords = significantWords(primaryQuery);
  const alternateWords = alternateQuery ? significantWords(alternateQuery) : [];
  // Relevance scoring draws on BOTH phrasings' vocabulary -- an alternateQuery describes the same
  // real-life scene differently, not a different concept, so a candidate found via either search
  // should be judged against the concept's full real vocabulary, not just whichever phrasing found it.
  const queryWords = Array.from(new Set([...primaryWords, ...alternateWords]));
  if (queryWords.length === 0) return { hit: null, rejectedCount: 0 };

  const broadenedFallback = primaryWords.slice(0, 2).join(" ");
  const attempts = [primaryQuery, alternateQuery, broadenedFallback].filter(
    (q, i, arr): q is string => Boolean(q) && arr.indexOf(q) === i,
  );
  let rejectedCount = 0;
  const aiAvailable = isAiRelevanceCheckAvailable();

  for (const attemptQuery of attempts) {
    let results;
    try {
      results = await searchImages({
        query: attemptQuery,
        minWidth: MIN_IMAGE_WIDTH,
        minHeight: MIN_IMAGE_HEIGHT,
        perPage: CANDIDATES_PER_QUERY,
      });
    } catch (error) {
      console.error(`[content-images] Pexels search failed for concept "${concept.query}" (query: "${attemptQuery}"):`, error instanceof Error ? error.message : error);
      continue;
    }

    const scored: { hit: NormalizedPexelsAsset; overlap: number }[] = [];
    const rawCandidates: { hit: NormalizedPexelsAsset; overlap: number }[] = [];
    for (const hit of results.hits) {
      if (isNonPhotographic(hit)) {
        rejectedCount += 1;
        continue;
      }
      if (isGenericScene(hit)) {
        rejectedCount += 1;
        continue;
      }
      if (usedIds.has(hit.id)) continue; // never the same photograph twice, even as a last resort
      if (isNearDuplicate(hit, selectedTagSets)) {
        rejectedCount += 1;
        continue;
      }
      const overlap = wordOverlapCount(hit, queryWords);
      rawCandidates.push({ hit, overlap });
      if (overlap > 0) scored.push({ hit, overlap });
    }
    // Prefer real word-overlap-scored hits when any exist (today's ranking, and cheaper). Only when a
    // real AI judgment is available AND nothing shared even one exact word does this widen the pool to
    // the raw (still non-photographic/duplicate/used-filtered) candidates -- see this function's own
    // header for why that gap is real with Pexels' sparse tag signal. Never widened without a real
    // judge available; see the deterministic fallback below.
    const candidatePool = scored.length > 0 ? scored : aiAvailable ? rawCandidates : [];
    if (candidatePool.length === 0) continue;
    candidatePool.sort((a, b) => b.overlap - a.overlap);
    const pool = candidatePool.slice(0, MAX_CANDIDATES_FOR_RELEVANCE_CHECK);

    if (aiAvailable) {
      const bestId = await pickMostRelevantCandidate(
        concept,
        pool.map(({ hit }) => ({ id: hit.id, tags: hit.tags })),
      );
      if (bestId !== null) {
        const picked = pool.find(({ hit }) => hit.id === bestId);
        if (picked) return { hit: picked.hit, rejectedCount };
      }
      // A real judgment ran and rejected every candidate here -- honor that, never fall back to a
      // weaker match just because the model said no.
      rejectedCount += pool.length;
      continue;
    }

    const strongMatch = pool.find(({ overlap }) => wordOverlapPasses(overlap, queryWords.length));
    if (strongMatch) return { hit: strongMatch.hit, rejectedCount };
    rejectedCount += pool.length; // only weak, single-incidental-word matches -- not a real match without AI judgment
  }

  return { hit: null, rejectedCount };
}

/**
 * Descriptive, non-keyword-stuffed alt text built only from the real hit's own real tags (what
 * Pexels' own alt-text-derived tagging says is actually visible), read as a natural phrase rather than a
 * mechanical "X for the Y section" label -- never invents a detail the tags don't support, never the
 * raw search query repeated, and never just the heading copied verbatim. Two images always produce
 * different alt text because they draw on two different hits' own distinct real tags.
 */
function buildAltText(section: ContentSectionDraft, hit: NormalizedPexelsAsset): string {
  const tags = hit.tags.filter(Boolean).slice(0, 3);
  if (tags.length === 0) {
    return `Photograph illustrating ${section.heading.toLowerCase()}`;
  }
  const phrase =
    tags.length === 1
      ? tags[0]!
      : tags.length === 2
        ? `${tags[0]} and ${tags[1]}`
        : `${tags.slice(0, -1).join(", ")}, and ${tags[tags.length - 1]}`;
  const capitalized = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  return `${capitalized}, illustrating ${section.heading.toLowerCase()}`;
}

// Mechanical, template-shaped alt text this codebase must never produce -- "Image for X", "X image",
// "Photo for X", etc. buildAltText() above structurally never generates these (it always draws from the
// hit's own real tags), but this is a real, testable safety net that inspects the ACTUAL final string at
// attachment time rather than only trusting the generator, per the explicit ALT-text validation
// requirement.
const MECHANICAL_ALT_TEXT_PATTERNS: readonly RegExp[] = [
  /^\s*(image|photo|picture)\s+for\b/i, // "Image for the Introduction section"
  // A short, comma-free "<thing> image/photo/picture" template. Deliberately anchored to the WHOLE
  // string and restricted to a small, comma-free character set: this codebase's own real alt text
  // always contains ", illustrating <heading>" (a comma), so it can never accidentally match here even
  // when the article's own heading happens to end in a word like "photo" (e.g. "...illustrating how to
  // store a passport photo" is safe -- the comma before "illustrating" excludes it).
  /^[\w\s'-]{1,60}\s(image|photo|picture)$/i,
];

/**
 * Non-blocking validation of one already-built alt text against the defects real ALT text must never
 * have: empty, identical to the section heading, a mechanical template shape, or a duplicate of another
 * image's alt text already used in this same article. Returns the (possibly empty) list of problems
 * found -- never used to reject or alter the image itself (buildAltText() is the single source of truth
 * for the actual text), only to loudly surface a real defect if one ever slips through.
 */
export function validateAltText(altText: string, heading: string, alreadyUsedAltTexts: ReadonlySet<string>): readonly string[] {
  const problems: string[] = [];
  const trimmed = altText.trim();
  if (!trimmed) {
    problems.push("empty");
    return problems;
  }
  if (trimmed.toLowerCase() === heading.trim().toLowerCase()) {
    problems.push("heading-only (identical to the section heading, not a real image description)");
  }
  if (MECHANICAL_ALT_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    problems.push("mechanical/template phrasing (e.g. \"Image for X\" / \"X image\")");
  }
  if (alreadyUsedAltTexts.has(trimmed.toLowerCase())) {
    problems.push("duplicate of another image's alt text already used in this article");
  }
  return problems;
}

// IMAGE PIPELINE FIX (2026-09-05): a real, live-observed defect -- image-concepts.ts's own real,
// article-grounded ImageConcept[] (either "ai"-derived or the zero-cost, deterministic "heuristic"
// fallback -- see deriveImageConcepts()'s own header) was ONLY ever used to search for a real Pexels
// photo. When no real Pexels match was found for a concept (as happened for Blog #1, "what is guest
// posting" -- 1 concept identified, 0 real photos found, 5 candidates rejected), the article ended up
// with ZERO image information of any kind, even though a real, article-grounded visual CONCEPT already
// existed. This builds a structured RECOMMENDATION from that SAME already-computed concept -- reusing the
// existing image-concepts.ts capability directly, never a second/competing concept-derivation pipeline --
// so a real visual opportunity is never silently discarded just because no matching stock photo exists.
// A recommendation is explicitly NOT a claim that an image exists: never a substitute for a real,
// downloaded ContentSectionImage, always rendered/labeled separately (see content-generator-shell.tsx).
const IMAGE_RECOMMENDATION_CAP = 3;

/**
 * REAL, LIVE-OBSERVED DEFECT FIX (2026-09-07): the real editorial minimum for a genuine long-form Blog --
 * distinct from IMAGE_RECOMMENDATION_CAP (a ceiling on recommendations) and image-concepts.ts's own
 * MIN_CONCEPTS/MAX_CONCEPTS (a "prefer" hint inside the AI prompt, never enforced). A real generation
 * identified only 1 visual concept and successfully attached it -- a fully "fulfilled" outcome by the
 * per-concept check above, yet still short of what a genuine long-form Blog editorially requires. See
 * processDraft()'s own use of this constant for the exact, honest (never-fabricated) enforcement.
 */
const MIN_REQUIRED_IMAGES = 2;

/** A URL/filesystem-safe suggested filename for whoever sources or creates this recommended image -- never a claim that a file actually exists. */
function slugifyForFilename(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "recommended-image"}.jpg`;
}

/**
 * Natural, descriptive alt text for a RECOMMENDED (not-yet-sourced) image -- built only from the real
 * concept's own query/heading, mirroring buildAltText()'s "X, illustrating Y" convention above. Never
 * invents a visual detail beyond what the concept itself already names; never the raw target keyword
 * repeated (concept.query is already a specific, concrete scene description, not a keyword list).
 */
function buildRecommendationAltText(concept: ImageConcept): string {
  const capitalized = concept.query.charAt(0).toUpperCase() + concept.query.slice(1);
  return `${capitalized}, illustrating the "${concept.targetHeading}" section`;
}

/**
 * Builds up to IMAGE_RECOMMENDATION_CAP structured recommendations from the article's own real,
 * already-computed visual concepts (see deriveImageConcepts()) -- never pads to hit a count, never
 * fabricates a concept beyond what the article's own real content supports. Reuses validateAltText()
 * (the same real check real attached images already go through) as defense-in-depth, never as the source
 * of truth for the text itself.
 */
function buildImageRecommendations(concepts: readonly ImageConcept[]): readonly ImageRecommendation[] {
  const usedAltTexts = new Set<string>();
  return concepts.slice(0, IMAGE_RECOMMENDATION_CAP).map((concept) => {
    const altText = buildRecommendationAltText(concept);
    const problems = validateAltText(altText, concept.targetHeading, usedAltTexts);
    if (problems.length > 0) {
      console.error(`[content-images] recommendation alt text problem(s) for "${concept.targetHeading}": ${problems.join("; ")} -- alt text: "${altText}"`);
    }
    usedAltTexts.add(altText.trim().toLowerCase());
    return {
      placement: `After the "${concept.targetHeading}" section`,
      concept: concept.query,
      filename: slugifyForFilename(concept.query),
      altText,
      purpose: concept.rationale,
    };
  });
}

interface ImageSelectionOutcome {
  readonly draft: ContentPieceDraft;
  readonly conceptsIdentified: number;
  readonly imagesSelected: number;
  readonly rejectedCount: number;
  readonly source: "ai" | "heuristic";
}

async function processDraft(draft: ContentPieceDraft): Promise<ImageSelectionOutcome> {
  const { concepts, source } = await deriveImageConcepts(draft);

  const imagesByHeading = new Map<string, ContentSectionImage>();
  const usedIds = new Set<number>();
  const selectedTagSets: string[][] = [];
  const usedAltTexts = new Set<string>();
  let rejectedCount = 0;

  for (const concept of concepts) {
    if (imagesByHeading.has(concept.targetHeading)) continue; // one image per section, per concept-to-section mapping

    const outcome = await findCandidateForConcept(concept, usedIds, selectedTagSets);
    rejectedCount += outcome.rejectedCount;
    if (!outcome.hit) continue;

    const section = draft.sections.find((s) => s.heading === concept.targetHeading);
    if (!section) continue;

    try {
      const stored = await downloadAndStoreAsset(outcome.hit.id, outcome.hit.url, "image");
      usedIds.add(outcome.hit.id);
      selectedTagSets.push([...outcome.hit.tags]);
      const altText = buildAltText(section, outcome.hit);
      const altTextProblems = validateAltText(altText, section.heading, usedAltTexts);
      if (altTextProblems.length > 0) {
        // Never blocks the image -- buildAltText() is still the single source of truth for the text
        // actually attached -- but a real defect here would otherwise go unnoticed, so it's surfaced
        // loudly rather than silently trusted.
        console.error(`[content-images] alt text problem(s) for "${section.heading}" (sourcePhotoId: ${outcome.hit.id}): ${altTextProblems.join("; ")} -- alt text: "${altText}"`);
      }
      usedAltTexts.add(altText.trim().toLowerCase());
      imagesByHeading.set(concept.targetHeading, {
        sourcePhotoId: outcome.hit.id,
        sourceUrl: outcome.hit.sourceUrl,
        imageUrl: stored.localUrl,
        width: outcome.hit.width,
        height: outcome.hit.height,
        creatorName: outcome.hit.creator.name,
        creatorProfileUrl: outcome.hit.creator.profileUrl,
        altText,
        placement: `After the "${section.heading}" section`,
      });
    } catch (error) {
      console.error(`[content-images] Pexels asset download failed for concept "${concept.query}" (sourcePhotoId: ${outcome.hit.id}):`, error instanceof Error ? error.message : error);
    }
  }

  const sections = draft.sections.map((section) => {
    const image = imagesByHeading.get(section.heading);
    return image ? { ...section, image } : section;
  });

  // REAL, LIVE-OBSERVED DEFECT FIX (2026-09-06): a real generation ("what is guest posting") showed the
  // SAME concept/section listed as a "recommendation" even though that exact section had ALREADY received
  // a real, successfully-attached Pexels photo -- confusing a genuinely fulfilled visual need with an
  // unfulfilled one. A recommendation is a "you still need to source this" signal; a concept whose
  // targetHeading already has a real image in `imagesByHeading` is, by definition, already fulfilled and
  // must never also appear as an outstanding recommendation. Reuses the SAME `concepts` already derived
  // above -- never a second call to deriveImageConcepts() (which would be a real, duplicate Anthropic/
  // Gemini call when an AI provider is configured).
  const unfulfilledConcepts = concepts.filter((concept) => !imagesByHeading.has(concept.targetHeading));
  const imageRecommendations = buildImageRecommendations(unfulfilledConcepts);

  // IMAGE VALIDATION GATE FIX (2026-09-07): a real, live-observed architectural gap -- the agent-layer
  // structural gate (ContentPieceAssembler.assemble() -> validateArticlePurity()) computes
  // generationStatus/publicationReady BEFORE this function ever runs (see content.ts's generateContent():
  // developContent() returns, THEN attachSupportingImages() runs on the result), so a draft could be
  // marked publicationReady:true while still carrying real, unfulfilled visual requirements -- a Blog
  // "passed" the image requirement merely because the model proposed 2-3 concepts, never because 2-3 real
  // assets were actually attached. Recomputes the SAME two fields here, now that the real image-attachment
  // outcome is known, folding the new finding into (never silently discarding) whatever the text-only gate
  // already found -- a text-contamination failure from upstream is never overwritten back to "ok" here.
  //
  // The failure condition is deliberately "any real, identified visual need went unfulfilled"
  // (imageRecommendations.length > 0), NOT a fixed "always need exactly N images" rule -- that would
  // contradict this same pipeline's own established "never pad to hit a count, zero is honest when the
  // article genuinely has no visual opportunity" philosophy (image-concepts.ts). A concept was only ever
  // identified because the article's own real content supported it; if it survives into
  // imageRecommendations, an ImageConcept the system itself decided was needed could not be honestly
  // fulfilled with a real, downloaded asset -- and a mere recommendation must never be accepted as if it
  // were an attachment.
  const imageRequirementUnfulfilled = imageRecommendations.length > 0;
  const imagePurityIssues: ArticlePurityIssue[] = imageRequirementUnfulfilled
    ? imageRecommendations.map((rec) => ({
        kind: "unfulfilled_image_requirement" as const,
        location: rec.placement,
        detail: `Required visual concept "${rec.concept}" (${rec.placement}) could not be fulfilled with a real, attached image asset -- only an unresolved recommendation exists. A recommendation is never treated as an attachment.`,
      }))
    : [];

  // REAL, LIVE-OBSERVED DEFECT FIX (2026-09-07): a real generation identified only 1 real visual concept
  // (a genuine, non-fabricated AI response -- the model itself decided only one opportunity existed) and
  // successfully attached a real photo for it, so `imageRecommendations` above was correctly empty --
  // yet a genuine long-form Blog editorially requires at least MIN_REQUIRED_IMAGES real images, regardless
  // of how few the model chose to propose this run. Distinct from imageRequirementUnfulfilled above (which
  // catches "the model asked for N, we got fewer than N"): this catches "the model asked for fewer than
  // the real editorial minimum in the first place, but articles this substantial should support more."
  // Deliberately scoped to articles where at least one real visual opportunity was already confirmed to
  // exist (conceptsIdentified > 0) -- an article with a genuinely empty visual angle (0 concepts, matching
  // this pipeline's own "never pad, zero is honest" philosophy) is not forced to invent a requirement that
  // was never real. Never fabricates an extra concept/image to hit the count -- only reports the honest
  // shortfall.
  const belowMinimumRequiredImages = concepts.length > 0 && imagesByHeading.size < MIN_REQUIRED_IMAGES;
  if (belowMinimumRequiredImages) {
    imagePurityIssues.push({
      kind: "unfulfilled_image_requirement",
      location: "article",
      detail: `Only ${imagesByHeading.size} of the required minimum ${MIN_REQUIRED_IMAGES} real, attached images could be obtained for this article, even though ${concepts.length} real visual concept(s) were identified. A shortfall is reported honestly rather than treated as satisfied.`,
    });
  }
  const imageRequirementFailed = imageRequirementUnfulfilled || belowMinimumRequiredImages;

  const generationStatus = draft.generationStatus === "failed_validation" || imageRequirementFailed ? "failed_validation" : draft.generationStatus;
  const publicationReady = draft.publicationReady && !imageRequirementFailed;
  const purityIssues = [...draft.purityIssues, ...imagePurityIssues];

  return {
    draft: { ...draft, sections, imageRecommendations, generationStatus, publicationReady, purityIssues },
    conceptsIdentified: concepts.length,
    imagesSelected: imagesByHeading.size,
    rejectedCount,
    source,
  };
}

/**
 * Augments a real SeoContentResult (already produced by the frozen
 * SeoContentAgent) with genuinely relevant, real-life-photography Pexels
 * images for qualifying sections. Called from content.ts right after
 * SeoContentAgent.developContent() returns -- the agent's own generation
 * logic is untouched; this is a post-processing step in the web adapter
 * layer, the same pattern dashboard.ts uses to attach Lighthouse's real
 * score without touching the audit agent itself.
 *
 * Every real finding from the selection process (how many genuine visual
 * concepts were identified, how many actually found a suitable authentic
 * photo, how many candidates were rejected as non-photographic or
 * near-duplicate) is surfaced honestly in `limitations` -- never silently
 * dropped, matching this codebase's own disclosure convention.
 */
export async function attachSupportingImages(result: SeoContentResult): Promise<SeoContentResult> {
  const outcomes = await Promise.all(result.contentDrafts.map(processDraft));

  const limitations = [...result.limitations];
  for (const outcome of outcomes) {
    if (outcome.conceptsIdentified === 0) continue; // nothing to report -- no real visual opportunity was found or attempted
    const sourceNote = outcome.source === "ai" ? "AI-derived, article-grounded" : "deterministic heuristic (no real image-concept provider configured)";
    limitations.push(
      `Image selection for "${outcome.draft.title}": ${sourceNote} visual concepts identified ${outcome.conceptsIdentified}; ` +
        `${outcome.imagesSelected} found a genuine, real-life photograph; ${outcome.rejectedCount} candidate(s) rejected ` +
        `as non-photographic (illustration/3D/render-style) or a near-duplicate of an already-selected image.`,
    );
  }

  return { ...result, contentDrafts: outcomes.map((o) => o.draft), limitations };
}
