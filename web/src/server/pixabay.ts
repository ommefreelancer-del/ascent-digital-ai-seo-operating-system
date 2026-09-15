// Server-side Pixabay client (https://pixabay.com/api/docs/) -- the shared
// service every agent/route goes through for royalty-free stock image and
// video search, mirroring this codebase's other external-API service
// modules (server/google-sheets.ts, server/gmail.ts): one module owns the
// real HTTP calls, response normalization, and error handling; nothing else
// calls pixabay.com directly.
//
// Pixabay's API terms require: results cached for 24h, no permanent
// hotlinking of *image* URLs (video URLs may be embedded directly), and no
// systematic mass downloads. This module enforces the first two
// structurally -- searchImages/searchVideos cache for 24h, and the actual
// asset bytes are only ever fetched by the explicit downloadAndStoreAsset()
// call below, never as a side effect of search -- and leaves the third to
// callers, who must only invoke this from real user/agent-triggered actions.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rateLimit } from "@/server/rate-limit";

const IMAGES_API_URL = "https://pixabay.com/api/";
const VIDEOS_API_URL = "https://pixabay.com/api/videos/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Pixabay's terms require caching results for 24 hours.
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

// Pixabay allows 100 requests/60s per key. This keeps this process's own
// outbound calls comfortably under that regardless of how many users/agents
// share the one server-side key, reusing the same bucket limiter
// server/rate-limit.ts already uses for auth endpoints rather than building
// a second one.
const SELF_THROTTLE_KEY = "pixabay-outbound";
const SELF_THROTTLE_LIMIT = 90;
const SELF_THROTTLE_WINDOW_MS = 60_000;

export class PixabayNotConfiguredError extends Error {
  constructor() {
    super("PIXABAY_API_KEY is not configured.");
    this.name = "PixabayNotConfiguredError";
  }
}

export class PixabayRateLimitError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super(`Pixabay rate limit exceeded${retryAfterSeconds ? ` -- retry after ${retryAfterSeconds}s` : ""}.`);
    this.name = "PixabayRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PixabayApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PixabayApiError";
    this.status = status;
  }
}

export type PixabayAssetType = "image" | "video";

export interface NormalizedPixabayAsset {
  readonly id: number;
  readonly type: PixabayAssetType;
  readonly sourceUrl: string; // pageURL -- the human-readable Pixabay page for this asset
  readonly previewUrl: string;
  readonly url: string; // usable image/video URL for this result -- not for permanent hotlinking, see downloadAndStoreAsset()
  readonly width: number;
  readonly height: number;
  readonly tags: readonly string[];
  readonly duration?: number; // videos only, seconds
  readonly creator: {
    readonly id: number;
    readonly name: string;
    readonly profileUrl: string;
    readonly imageUrl: string;
  };
}

export interface PixabaySearchResult {
  readonly total: number;
  readonly totalHits: number;
  readonly page: number;
  readonly perPage: number;
  readonly hits: readonly NormalizedPixabayAsset[];
}

export interface ImageSearchParams {
  query?: string;
  language?: string;
  imageType?: "all" | "photo" | "illustration" | "vector";
  orientation?: "all" | "horizontal" | "vertical";
  category?: string;
  minWidth?: number;
  minHeight?: number;
  safeSearch?: boolean;
  order?: "popular" | "latest";
  page?: number;
  perPage?: number;
}

export interface VideoSearchParams {
  query?: string;
  language?: string;
  videoType?: "all" | "film" | "animation";
  category?: string;
  minWidth?: number;
  minHeight?: number;
  safeSearch?: boolean;
  order?: "popular" | "latest";
  page?: number;
  perPage?: number;
}

interface PixabayImageHitRaw {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  webformatURL: string;
  webformatWidth: number;
  webformatHeight: number;
  user_id: number;
  user: string;
  userImageURL: string;
}

interface PixabayVideoRenditionRaw {
  url: string;
  width: number;
  height: number;
  thumbnail: string;
}

interface PixabayVideoHitRaw {
  id: number;
  pageURL: string;
  tags: string;
  duration: number;
  videos: {
    large: PixabayVideoRenditionRaw;
    medium: PixabayVideoRenditionRaw;
    small: PixabayVideoRenditionRaw;
    tiny: PixabayVideoRenditionRaw;
  };
  user_id: number;
  user: string;
  userImageURL: string;
}

function requireApiKey(): string {
  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) throw new PixabayNotConfiguredError();
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const cache = new Map<string, { expiresAt: number; data: PixabaySearchResult }>();

function cacheGet(key: string): PixabaySearchResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key: string, data: PixabaySearchResult): void {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }
}

/** Real HTTP call to a Pixabay endpoint with a timeout, and retry-with-backoff on 429/5xx. Throws PixabayRateLimitError/PixabayApiError on final failure. */
async function fetchPixabay(url: string): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw timedOut
        ? new PixabayApiError(0, `Pixabay request timed out after ${REQUEST_TIMEOUT_MS}ms.`)
        : new PixabayApiError(0, `Pixabay request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timeout);

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
      if (attempt < MAX_RETRIES) {
        await sleep(retryAfterSeconds ? retryAfterSeconds * 1000 : RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new PixabayRateLimitError(retryAfterSeconds);
    }

    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new PixabayApiError(res.status, `Pixabay API failed: ${res.status} ${res.statusText} -- ${body}`);
    }
    return body ? JSON.parse(body) : {};
  }
  throw new PixabayApiError(0, "Pixabay request failed after retries.");
}

function normalizeTags(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function creatorFrom(hit: { user_id: number; user: string; userImageURL: string }) {
  return {
    id: hit.user_id,
    name: hit.user,
    profileUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}-${hit.user_id}/`,
    imageUrl: hit.userImageURL,
  };
}

function normalizeImageHit(hit: PixabayImageHitRaw): NormalizedPixabayAsset {
  return {
    id: hit.id,
    type: "image",
    sourceUrl: hit.pageURL,
    previewUrl: hit.previewURL,
    url: hit.webformatURL,
    width: hit.webformatWidth,
    height: hit.webformatHeight,
    tags: normalizeTags(hit.tags),
    creator: creatorFrom(hit),
  };
}

function normalizeVideoHit(hit: PixabayVideoHitRaw): NormalizedPixabayAsset {
  const rendition = hit.videos.medium ?? hit.videos.small ?? hit.videos.large ?? hit.videos.tiny;
  return {
    id: hit.id,
    type: "video",
    sourceUrl: hit.pageURL,
    previewUrl: rendition.thumbnail,
    url: rendition.url,
    width: rendition.width,
    height: rendition.height,
    tags: normalizeTags(hit.tags),
    duration: hit.duration,
    creator: creatorFrom(hit),
  };
}

export interface PixabayConnectionStatus {
  readonly connected: boolean;
}

/**
 * Pixabay isn't a per-user OAuth connection like the Google integrations
 * (google-sheets.ts, gmail.ts, google-search-console.ts) -- it's a single
 * server-side API key from PIXABAY_API_KEY, so there's no per-user DB row to
 * check. "Connected" means the key is configured AND a real search against
 * Pixabay succeeds; this reuses searchImages()'s own 24h cache, so repeated
 * calls (e.g. every Settings page load) don't hit Pixabay's API each time.
 */
export async function getConnectionStatus(): Promise<PixabayConnectionStatus> {
  if (!process.env.PIXABAY_API_KEY) return { connected: false };
  try {
    await searchImages({ query: "nature", perPage: 3 });
    return { connected: true };
  } catch {
    return { connected: false };
  }
}

/** Real call to Pixabay's Images API (https://pixabay.com/api/). Cached for 24h per Pixabay's terms. */
export async function searchImages(params: ImageSearchParams = {}): Promise<PixabaySearchResult> {
  const apiKey = requireApiKey();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  const qs = new URLSearchParams({
    key: apiKey,
    safesearch: String(params.safeSearch ?? false),
    order: params.order ?? "popular",
    page: String(page),
    per_page: String(perPage),
  });
  if (params.query) qs.set("q", params.query);
  if (params.language) qs.set("lang", params.language);
  if (params.imageType) qs.set("image_type", params.imageType);
  if (params.orientation) qs.set("orientation", params.orientation);
  if (params.category) qs.set("category", params.category);
  if (params.minWidth) qs.set("min_width", String(params.minWidth));
  if (params.minHeight) qs.set("min_height", String(params.minHeight));

  const cacheKey = `images:${qs.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!rateLimit(SELF_THROTTLE_KEY, SELF_THROTTLE_LIMIT, SELF_THROTTLE_WINDOW_MS)) {
    throw new PixabayRateLimitError(null);
  }

  const data = (await fetchPixabay(`${IMAGES_API_URL}?${qs.toString()}`)) as { total?: number; totalHits?: number; hits?: PixabayImageHitRaw[] };
  const result: PixabaySearchResult = {
    total: data.total ?? 0,
    totalHits: data.totalHits ?? 0,
    page,
    perPage,
    hits: (data.hits ?? []).map(normalizeImageHit),
  };
  cacheSet(cacheKey, result);
  return result;
}

/** Real call to Pixabay's Video API (https://pixabay.com/api/videos/). Cached for 24h per Pixabay's terms. */
export async function searchVideos(params: VideoSearchParams = {}): Promise<PixabaySearchResult> {
  const apiKey = requireApiKey();
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 20;

  const qs = new URLSearchParams({
    key: apiKey,
    safesearch: String(params.safeSearch ?? false),
    order: params.order ?? "popular",
    page: String(page),
    per_page: String(perPage),
  });
  if (params.query) qs.set("q", params.query);
  if (params.language) qs.set("lang", params.language);
  if (params.videoType) qs.set("video_type", params.videoType);
  if (params.category) qs.set("category", params.category);
  if (params.minWidth) qs.set("min_width", String(params.minWidth));
  if (params.minHeight) qs.set("min_height", String(params.minHeight));

  const cacheKey = `videos:${qs.toString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  if (!rateLimit(SELF_THROTTLE_KEY, SELF_THROTTLE_LIMIT, SELF_THROTTLE_WINDOW_MS)) {
    throw new PixabayRateLimitError(null);
  }

  const data = (await fetchPixabay(`${VIDEOS_API_URL}?${qs.toString()}`)) as { total?: number; totalHits?: number; hits?: PixabayVideoHitRaw[] };
  const result: PixabaySearchResult = {
    total: data.total ?? 0,
    totalHits: data.totalHits ?? 0,
    page,
    perPage,
    hits: (data.hits ?? []).map(normalizeVideoHit),
  };
  cacheSet(cacheKey, result);
  return result;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "pixabay");

function assertPixabayHost(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.hostname !== "pixabay.com" && !url.hostname.endsWith(".pixabay.com")) {
    throw new PixabayApiError(400, `Refusing to download from a non-Pixabay host: ${url.hostname}`);
  }
  return url;
}

export interface StoredPixabayAsset {
  readonly localUrl: string; // e.g. /uploads/pixabay/<file> -- served by Next.js from /public
}

/**
 * Downloads a single, explicitly-selected Pixabay asset's actual bytes and
 * stores them under this server's own /public/uploads/pixabay, returning a
 * local URL. This is the ONLY function in this module that fetches asset
 * bytes -- searchImages/searchVideos never do. Pixabay's terms prohibit
 * permanently hotlinking *image* URLs; this is how a caller satisfies that
 * once a human/agent has actually chosen to use a specific asset. Must only
 * be called for one explicitly-selected asset at a time, never in a loop
 * over search results -- Pixabay's terms prohibit systematic mass downloads.
 */
export async function downloadAndStoreAsset(assetId: number, sourceAssetUrl: string, type: PixabayAssetType): Promise<StoredPixabayAsset> {
  const url = assertPixabayHost(sourceAssetUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    throw new PixabayApiError(0, `Failed to download Pixabay asset ${assetId}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new PixabayApiError(res.status, `Failed to download Pixabay asset ${assetId}: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(url.pathname).toLowerCase() || (type === "video" ? ".mp4" : ".jpg");
  const filename = `${assetId}-${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return { localUrl: `/uploads/pixabay/${filename}` };
}
