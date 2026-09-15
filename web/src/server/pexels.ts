// Server-side Pexels client (https://www.pexels.com/api/documentation/) --
// the content-generation image pipeline's real-photo source (see
// server/backend/content-images.ts), mirroring this codebase's other
// external-API service modules (server/pixabay.ts, server/google-sheets.ts):
// one module owns the real HTTP calls, response normalization, and error
// handling; nothing else in the content-generation path calls
// api.pexels.com directly.
//
// Chosen over Pixabay for this specific pipeline after a live validation
// found Pixabay's catalog returning 0 genuinely relevant photographic
// matches across several real article-grounded concepts (see git history /
// project notes, 2026-09-01) -- Pexels' curated, photography-only catalog
// (no illustrations/vectors mixed into the same search results the way
// Pixabay's does) was chosen as the replacement primary source. This is
// UNRELATED to the separate Graphic Design Agent Pixabay asset browser
// (server/backend/graphic-design.ts, /api/assets/pixabay/*), which still
// uses server/pixabay.ts and PIXABAY_API_KEY exactly as before -- only the
// content-generation pipeline's image source changed.
//
// Pexels' API terms permit direct hotlinking of image URLs (unlike
// Pixabay's), but this module still downloads and stores one explicitly-
// selected asset locally via downloadAndStoreAsset(), matching the existing
// pipeline's own architecture (content-images.ts calls this identically
// regardless of provider) rather than introducing a second image-serving
// path.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rateLimit } from "@/server/rate-limit";

const IMAGES_API_URL = "https://api.pexels.com/v1/search";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // same caching discipline as server/pixabay.ts
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

// Pexels' default free-tier limit is 200 requests/hour. This keeps this
// process's own outbound calls comfortably under that regardless of how many
// users/agents share the one server-side key, reusing the same bucket
// limiter server/pixabay.ts and the auth endpoints already use.
const SELF_THROTTLE_KEY = "pexels-outbound";
const SELF_THROTTLE_LIMIT = 180;
const SELF_THROTTLE_WINDOW_MS = 60 * 60 * 1000;

export class PexelsNotConfiguredError extends Error {
  constructor() {
    super("PEXELS_API_KEY is not configured.");
    this.name = "PexelsNotConfiguredError";
  }
}

export class PexelsRateLimitError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super(`Pexels rate limit exceeded${retryAfterSeconds ? ` -- retry after ${retryAfterSeconds}s` : ""}.`);
    this.name = "PexelsRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PexelsApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PexelsApiError";
    this.status = status;
  }
}

export type PexelsAssetType = "image";

/**
 * Field-compatible with server/pixabay.ts's NormalizedPixabayAsset (same
 * shape: id, sourceUrl, previewUrl, url, width, height, tags, creator) so
 * content-images.ts's existing relevance/dedup/alt-text logic works
 * unchanged against either provider. Pexels' API has no tag/keyword field
 * (unlike Pixabay's contributor tags) -- `tags` here is real, derived
 * directly from Pexels' own `alt` description text (never invented), and
 * `description` keeps that original real string verbatim for callers that
 * want the natural phrase rather than a word list.
 */
export interface NormalizedPexelsAsset {
  readonly id: number;
  readonly type: PexelsAssetType;
  readonly sourceUrl: string; // Pexels' own photo page URL
  readonly previewUrl: string;
  readonly url: string; // usable image URL for this result (a real, large-resolution rendition)
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[]; // significant words extracted from Pexels' own real `alt` text
  readonly description: string; // Pexels' own real alt text, verbatim (may be empty -- never fabricated)
  readonly creator: {
    readonly id: number;
    readonly name: string;
    readonly profileUrl: string;
  };
}

export interface PexelsSearchResult {
  readonly total: number;
  readonly totalHits: number;
  readonly page: number;
  readonly perPage: number;
  readonly hits: readonly NormalizedPexelsAsset[];
}

export interface ImageSearchParams {
  query?: string;
  orientation?: "landscape" | "portrait" | "square";
  minWidth?: number;
  minHeight?: number;
  page?: number;
  perPage?: number;
}

interface PexelsPhotoRaw {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_id: number;
  photographer_url: string;
  alt: string | null;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    tiny: string;
  };
}

function requireApiKey(): string {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new PexelsNotConfiguredError();
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const cache = new Map<string, { expiresAt: number; data: PexelsSearchResult }>();

function cacheGet(key: string): PexelsSearchResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: PexelsSearchResult): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "how",
  "your", "you", "can", "this", "that", "is", "are", "into", "from", "their",
  "by", "at", "near",
]);

/**
 * Real, honest "tags" derived only from Pexels' own `alt` description text
 * (never invented) -- Pexels' search API doesn't return a keyword/tag list
 * the way Pixabay's does, so this is the closest real signal available for
 * the same word-overlap/near-duplicate/non-photographic-marker checks
 * content-images.ts already runs against `tags`.
 */
function tagsFromAlt(alt: string | null): string[] {
  if (!alt) return [];
  return Array.from(
    new Set(
      alt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        // >= 2 (not 3) specifically so a real "3d" token in Pexels' own alt text survives into tags --
        // needed for the "3d render"/"3d model" non-photographic markers in content-images.ts to match.
        .filter((word) => word.length >= 2 && !STOPWORDS.has(word)),
    ),
  );
}

/** Real HTTP call to a Pexels endpoint with a timeout, and retry-with-backoff on 429/5xx. Throws PexelsRateLimitError/PexelsApiError on final failure. */
async function fetchPexels(url: string, apiKey: string): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, headers: { Authorization: apiKey } });
    } catch (err) {
      clearTimeout(timeout);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw timedOut
        ? new PexelsApiError(0, `Pexels request timed out after ${REQUEST_TIMEOUT_MS}ms.`)
        : new PexelsApiError(0, `Pexels request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timeout);

    if (res.status === 429) {
      // Pexels' real rate-limit headers: X-Ratelimit-Reset is a Unix timestamp (seconds), not a delta.
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const retryAfterSeconds = resetHeader ? Math.max(0, Number(resetHeader) - Math.floor(Date.now() / 1000)) : null;
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfterSeconds ? retryAfterSeconds * 1000 : RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new PexelsRateLimitError(retryAfterSeconds);
    }

    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new PexelsApiError(res.status, `Pexels API failed: ${res.status} ${res.statusText} -- ${body}`);
    }
    return body ? JSON.parse(body) : {};
  }
  throw new PexelsApiError(0, "Pexels request failed after retries.");
}

function creatorFrom(hit: PexelsPhotoRaw) {
  return { id: hit.photographer_id, name: hit.photographer, profileUrl: hit.photographer_url };
}

function normalizePhotoHit(hit: PexelsPhotoRaw): NormalizedPexelsAsset {
  return {
    id: hit.id,
    type: "image",
    sourceUrl: hit.url,
    previewUrl: hit.src.medium,
    url: hit.src.large2x ?? hit.src.large,
    width: hit.width,
    height: hit.height,
    tags: tagsFromAlt(hit.alt),
    description: hit.alt ?? "",
    creator: creatorFrom(hit),
  };
}

export interface PexelsConnectionStatus {
  readonly connected: boolean;
}

/**
 * "Connected" means PEXELS_API_KEY is configured AND a real search against
 * Pexels succeeds -- mirrors server/pixabay.ts's getConnectionStatus(),
 * reusing searchImages()'s own 24h cache so repeated calls don't hit
 * Pexels' API each time.
 */
export async function getConnectionStatus(): Promise<PexelsConnectionStatus> {
  if (!process.env.PEXELS_API_KEY) return { connected: false };
  try {
    await searchImages({ query: "nature", perPage: 3 });
    return { connected: true };
  } catch {
    return { connected: false };
  }
}

/**
 * Real call to Pexels' Photo Search API (https://api.pexels.com/v1/search).
 * Cached for 24h, matching server/pixabay.ts's own caching discipline.
 * Pexels has no server-side min-width/min-height or image-type params (its
 * catalog is real photography only) -- `minWidth`/`minHeight` are enforced
 * here by honestly filtering the REAL dimensions Pexels reports for each
 * hit, never by fabricating or assuming a resolution.
 */
export async function searchImages(params: ImageSearchParams = {}): Promise<PexelsSearchResult> {
  const apiKey = requireApiKey();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (params.query) qs.set("query", params.query);
  if (params.orientation) qs.set("orientation", params.orientation);

  const cacheKey = `images:${qs.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!rateLimit(SELF_THROTTLE_KEY, SELF_THROTTLE_LIMIT, SELF_THROTTLE_WINDOW_MS)) {
    throw new PexelsRateLimitError(null);
  }

  const data = (await fetchPexels(`${IMAGES_API_URL}?${qs.toString()}`, apiKey)) as {
    total_results?: number;
    page?: number;
    per_page?: number;
    photos?: PexelsPhotoRaw[];
  };
  const allHits = (data.photos ?? []).map(normalizePhotoHit);
  const hits = allHits.filter(
    (hit) => hit.width >= (params.minWidth ?? 0) && hit.height >= (params.minHeight ?? 0),
  );
  const result: PexelsSearchResult = {
    total: data.total_results ?? 0,
    totalHits: allHits.length,
    page,
    perPage,
    hits,
  };
  cacheSet(cacheKey, result);
  return result;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "pexels");

function assertPexelsHost(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.hostname !== "images.pexels.com" && !url.hostname.endsWith(".pexels.com")) {
    throw new PexelsApiError(400, `Refusing to download from a non-Pexels host: ${url.hostname}`);
  }
  return url;
}

export interface StoredPexelsAsset {
  readonly localUrl: string; // e.g. /uploads/pexels/<file> -- served by Next.js from /public
}

/**
 * Downloads a single, explicitly-selected Pexels asset's actual bytes and
 * stores them under this server's own /public/uploads/pexels, returning a
 * local URL -- mirrors server/pixabay.ts's downloadAndStoreAsset() exactly
 * (same signature, same "only ever called for one explicitly-selected asset,
 * never in a loop over search results" contract), so content-images.ts calls
 * this identically regardless of which provider is behind it.
 */
export async function downloadAndStoreAsset(assetId: number, sourceAssetUrl: string, _type: PexelsAssetType): Promise<StoredPexelsAsset> {
  const url = assertPexelsHost(sourceAssetUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    throw new PexelsApiError(0, `Failed to download Pexels asset ${assetId}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new PexelsApiError(res.status, `Failed to download Pexels asset ${assetId}: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(url.pathname).toLowerCase() || ".jpg";
  const filename = `${assetId}-${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return { localUrl: `/uploads/pexels/${filename}` };
}
