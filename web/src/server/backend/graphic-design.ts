// REAL DISPATCH (VISUAL-ASSET ROUTING FIX, 2026-08-27): the Graphic Design
// Agent's real, chat-dispatch-wired execution path for pure visual/image-
// sourcing requests. Before this, an assignedAgentId of "graphic-design-agent"
// had no branch in web/src/app/api/workspace/messages/route.ts's dispatch
// chain at all, so even a correctly-routed request would have fallen through
// to the generic, tool-less Claude role-play reply -- and, before the
// companion routing fix (src/boss-agent/routing/tag-weighted-routing-strategy.ts's
// new hasVisualAssetIntent override), the request was never even routed here
// in the first place (it scored higher for seo-content-agent and was run
// through the automatic SEO content-generation pipeline instead, which
// treated the user's full message as a target keyword).
//
// This module goes through the SAME, already-existing, already-tested
// Pixabay service every other Pixabay caller in this codebase uses
// (server/pixabay.ts -- see its own header: "the shared service every
// agent/route goes through"). Nothing here talks to pixabay.com directly or
// duplicates that module's HTTP/caching/rate-limit logic.
//
// Never fabricates: a recommendation is only ever a REAL Pixabay search hit
// this process actually received back from a real API call. Not configured,
// rate-limited, a real API failure, or zero results -- every case is
// reported honestly via `limitations`, never a placeholder standing in for a
// real image (mirrors content-images.ts's own "never fabricate" convention
// for the SEO Content Agent's own, separate Pixabay use).
//
// Real site context (GLOBAL_RULES.md-consistent, never invented): when a
// connected/mentioned site URL is available, this fetches the real, live
// homepage HTML through the SAME canonical fetchHtml() website-audit.ts
// already re-exports (src/core/crawling/fetch-html.ts -- the one real,
// SSRF-guarded HTML fetcher in this codebase), and uses its real, visible
// text -- the site's actual stated services/skills -- as the primary source
// of search-query vocabulary. No URL, or a failed fetch, degrades honestly
// (search still runs, grounded only in the request text) rather than
// failing the whole request or inventing site content.

import { searchImages, PixabayNotConfiguredError, PixabayRateLimitError, PixabayApiError, type NormalizedPixabayAsset } from "@/server/pixabay";
import { fetchHtml } from "./website-audit";

// Pixabay's real Images API rejects any `q` longer than 100 characters with
// an HTTP 400 (confirmed directly against the live API -- same limit
// content-images.ts's own MAX_QUERY_LENGTH documents for the SEO Content
// Agent's separate Pixabay use).
const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_WORDS = 6;
const SITE_TEXT_MAX_CHARS = 4000;

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "how", "your", "you", "can", "this", "that", "is", "are", "into", "from", "their", "our", "its", "about"]);

// Meta-instruction vocabulary from the REQUEST ITSELF ("find relevant images
// using Pixabay based on the website's actual services and skills") -- real
// words, but describing the ASK, not a visual subject. Excluded only from
// the message-text fallback path below, never from real site text, so a
// query is never built out of the user's own instructions to ADASOS.
const GENERIC_REQUEST_WORDS = new Set([
  "pixabay", "image", "images", "photo", "photos", "picture", "pictures", "graphic", "graphics",
  "visual", "visuals", "design", "designer", "find", "relevant", "based", "actual", "website",
  "use", "using", "connected", "api", "please", "need", "want", "looking", "recommend", "recommendations",
]);

function significantWords(text: string, exclude: ReadonlySet<string> = new Set()): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word) && !exclude.has(word));
}

/** Strips real HTML down to its real visible text -- script/style content removed, tags stripped, whitespace collapsed. Never invents text that wasn't in the real response body. */
function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Real network fetch of the connected/mentioned site's homepage, through the
 * one canonical, SSRF-guarded fetchHtml() this codebase has. Returns `null`
 * (never a fabricated substitute) when there is no URL to fetch, or the
 * fetch genuinely fails -- the caller degrades honestly rather than
 * inventing "the website's actual services and skills".
 */
async function fetchSiteTextContext(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const html = await fetchHtml(url);
    const text = extractVisibleText(html).slice(0, SITE_TEXT_MAX_CHARS);
    return text.length > 0 ? text : null;
  } catch (error) {
    console.error(`[graphic-design] Failed to fetch real site content from ${url} for visual-asset context:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Builds a Pixabay-safe search query, real site content preferred over the
 * request's own meta-instruction wording -- see this module's header for
 * why. Falls back to the request text itself (excluding generic
 * "find/images/pixabay/website" instruction words) only when no real site
 * text is available. Never returns a query over Pixabay's own 100-character
 * limit; also caps word count, since a long tag-soup query returns worse
 * Pixabay matches than a focused few-word one.
 */
function buildVisualQuery(message: string, siteText: string | null): string {
  const siteWords = siteText ? significantWords(siteText) : [];
  const source = siteWords.length > 0 ? siteWords : significantWords(message, GENERIC_REQUEST_WORDS);
  const unique = Array.from(new Set(source));

  let query = "";
  let wordCount = 0;
  for (const word of unique) {
    if (wordCount >= MAX_QUERY_WORDS) break;
    const candidate = query ? `${query} ${word}` : word;
    if (candidate.length > MAX_QUERY_LENGTH) continue;
    query = candidate;
    wordCount += 1;
  }
  return query;
}

export interface GraphicDesignAssetRecommendation {
  readonly pixabayId: number;
  readonly type: "image" | "video";
  readonly sourceUrl: string;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[];
  readonly creatorName: string;
  readonly creatorProfileUrl: string;
}

export interface GraphicDesignRunResult {
  readonly dataAvailable: boolean;
  readonly query: string;
  readonly siteContextUsed: boolean;
  readonly siteContextUrl: string | null;
  readonly recommendations: readonly GraphicDesignAssetRecommendation[];
  readonly limitations: readonly string[];
}

function toRecommendation(hit: NormalizedPixabayAsset): GraphicDesignAssetRecommendation {
  return {
    pixabayId: hit.id,
    type: hit.type,
    sourceUrl: hit.sourceUrl,
    previewUrl: hit.previewUrl,
    width: hit.width,
    height: hit.height,
    tags: hit.tags,
    creatorName: hit.creator.name,
    creatorProfileUrl: hit.creator.profileUrl,
  };
}

/**
 * Real dispatch for a pure visual/image-sourcing request assigned to
 * graphic-design-agent: fetches real site context (when a URL is
 * available), builds a real Pixabay search query from it, and calls the
 * SAME real, shared Pixabay service (server/pixabay.ts) every other Pixabay
 * caller in this codebase goes through. Every branch is honest about what
 * actually happened -- never fabricates a result, an image, or site content
 * that wasn't genuinely fetched.
 */
export async function runGraphicDesignRequest(message: string, siteUrl: string | null): Promise<GraphicDesignRunResult> {
  const siteText = await fetchSiteTextContext(siteUrl);
  const query = buildVisualQuery(message, siteText);
  const limitations: string[] = [];

  if (!siteText) {
    limitations.push(
      siteUrl
        ? `Could not fetch real content from ${siteUrl} to ground this search in the website's actual services/skills -- the search below uses only the request text.`
        : "No connected or mentioned website URL was available, so this search could not be grounded in the site's actual services/skills -- it uses only the request text.",
    );
  }

  if (!query) {
    return {
      dataAvailable: false,
      query: "",
      siteContextUsed: Boolean(siteText),
      siteContextUrl: siteUrl,
      recommendations: [],
      limitations: [...limitations, "No specific visual subject could be extracted from the request or the site's real content to search Pixabay with."],
    };
  }

  try {
    const results = await searchImages({ query, safeSearch: true, perPage: 12 });
    const recommendations = results.hits.map(toRecommendation);
    if (recommendations.length === 0) {
      limitations.push(`The real Pixabay search for "${query}" returned no results -- nothing was fabricated to fill the gap.`);
    }
    return { dataAvailable: recommendations.length > 0, query, siteContextUsed: Boolean(siteText), siteContextUrl: siteUrl, recommendations, limitations };
  } catch (error) {
    const reason =
      error instanceof PixabayNotConfiguredError
        ? "The Pixabay integration is not configured (PIXABAY_API_KEY missing) -- no real images can be fetched until it is."
        : error instanceof PixabayRateLimitError
          ? "Pixabay's rate limit was hit -- please try again shortly."
          : error instanceof PixabayApiError
            ? `The real Pixabay API call failed: ${error.message}`
            : `An unexpected error occurred calling Pixabay: ${error instanceof Error ? error.message : String(error)}`;
    return { dataAvailable: false, query, siteContextUsed: Boolean(siteText), siteContextUrl: siteUrl, recommendations: [], limitations: [...limitations, reason] };
  }
}

/** Reports the real GraphicDesignRunResult -- every recommendation traces to a real, live Pixabay search hit; never a fabricated placeholder. */
export function summarizeGraphicDesignForChat(result: GraphicDesignRunResult): string {
  const lines: string[] = [
    `Ran a real Pixabay image search (query: "${result.query || "(none)"}")` +
      `${result.siteContextUsed ? ` -- grounded in the real, live content fetched from ${result.siteContextUrl}` : ""}.`,
    "",
  ];

  if (result.recommendations.length > 0) {
    lines.push(`${result.recommendations.length} real, royalty-free Pixabay result(s):`, "");
    for (const rec of result.recommendations) {
      lines.push(`- **Pixabay #${rec.pixabayId}** (${rec.type}, ${rec.width}x${rec.height}) -- tags: ${rec.tags.join(", ") || "none"}`);
      lines.push(`  - Preview: ${rec.previewUrl}`);
      lines.push(`  - Source: ${rec.sourceUrl}`);
      lines.push(`  - Creator: ${rec.creatorName} (${rec.creatorProfileUrl})`);
    }
    lines.push(
      "",
      "Every result above is a real, live Pixabay search hit -- nothing was fabricated. Tell me which one(s) to use " +
        "and I'll download and store the real asset for the site (Pixabay's terms require assets to be downloaded " +
        "through the platform before use, never hotlinked).",
    );
  } else {
    lines.push("No real Pixabay results are available for this request.");
  }

  if (result.limitations.length > 0) {
    lines.push("", ...result.limitations);
  }

  return lines.join("\n");
}
