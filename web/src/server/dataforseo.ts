// Server-side DataForSEO Backlinks API client (https://docs.dataforseo.com/v3/backlinks-overview/)
// -- the shared service every agent/route goes through for real backlink
// intelligence, mirroring this codebase's other external-API service modules
// (server/pixabay.ts, server/google-sheets.ts): one module owns the real
// HTTP calls, response normalization, and error handling; nothing else
// calls api.dataforseo.com directly.
//
// DataForSEO uses HTTP Basic Auth (API login + API password, NOT the
// account's own login/password -- see https://docs.dataforseo.com/v3/auth/),
// obtained from https://app.dataforseo.com/api-access. Unlike Pixabay,
// real (non-sandbox) Backlinks API calls cost real money per call -- there
// is no free tier beyond a one-time $1 trial credit -- so this module never
// makes a real call as a side effect of a status check, and every call goes
// through a conservative self-throttle to bound accidental spend.
//
// Two endpoints only, matching what this codebase's agents actually need
// (Off-Page SEO / Competitor Intelligence backlink profiles): Backlinks Live
// (per-link detail: referring domain, anchor text, dofollow/nofollow, link
// rank, spam score) and Summary Live (target-level totals: rank, backlink
// count, referring domain count, aggregate spam score). Every other
// Backlinks API endpoint (Anchors, Domain Pages, Referring Networks,
// Competitors, Domain/Page Intersection, History, Timeseries, bulk
// variants) is deliberately not implemented -- nothing in this codebase's
// agent architecture needs them yet.
//
// DataForSEO's own "rank" and "spam score" metrics are DataForSEO's
// proprietary models -- NOT Moz Domain Authority, NOT Ahrefs Domain Rating,
// and not a certified toxic/not-toxic verdict. Every normalized field below
// keeps DataForSEO's own field names/semantics rather than relabeling them
// as a third-party or generic metric, per this project's source-attribution
// requirement.

import { rateLimit } from "@/server/rate-limit";

const PRODUCTION_BASE_URL = "https://api.dataforseo.com/v3";
const SANDBOX_BASE_URL = "https://sandbox.dataforseo.com/v3";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

// Real Backlinks API calls cost money per call (unlike Pixabay/GA/GSC).
// This bounds this process's own outbound calls regardless of how many
// users/agents share the one server-side credential pair, reusing the same
// bucket limiter server/rate-limit.ts already uses for auth endpoints.
// Deliberately conservative -- DataForSEO itself allows far more (2000/min).
const SELF_THROTTLE_KEY = "dataforseo-outbound";
const SELF_THROTTLE_LIMIT = 20;
const SELF_THROTTLE_WINDOW_MS = 60_000;

export class DataForSeoNotConfiguredError extends Error {
  constructor() {
    super("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not configured.");
    this.name = "DataForSeoNotConfiguredError";
  }
}

export class DataForSeoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoValidationError";
  }
}

export class DataForSeoRateLimitError extends Error {
  constructor() {
    super("DataForSeo self-throttle exceeded -- too many backlink requests in the last minute. This protects real account spend; wait and retry.");
    this.name = "DataForSeoRateLimitError";
  }
}

export class DataForSeoApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DataForSeoApiError";
    this.status = status;
  }
}

/**
 * Thrown when a Keyword Data / Labs call would hit DataForSEO's real, billed
 * production API without explicit opt-in. Scoped to the keyword functions
 * only (getSearchVolume/getKeywordDifficulty below) -- the existing Backlinks
 * functions above (getBacklinksSummary/getBacklinks) predate this gate and
 * are deliberately left as-is, so this must never be read as "Backlinks
 * production calls are also blocked": they are not.
 */
export class DataForSeoProductionBlockedError extends Error {
  constructor() {
    super(
      "DataForSEO Keyword Data/Labs production calls are blocked by default. Set DATAFORSEO_SANDBOX=true to use " +
        "the free Sandbox, or set DATAFORSEO_KEYWORDS_ALLOW_PRODUCTION=true to explicitly allow real, billed " +
        "keyword calls.",
    );
    this.name = "DataForSeoProductionBlockedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSandboxMode(): boolean {
  return process.env.DATAFORSEO_SANDBOX === "true";
}

function requireCredentials(): { login: string; password: string } {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new DataForSeoNotConfiguredError();
  return { login, password };
}

function baseUrl(): string {
  return isSandboxMode() ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
}

/** DataForSEO's own field-naming convention: raw item shape, not yet normalized. */
interface RawTaskResponse<TResult> {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<TResult | null> | null;
}

interface RawApiResponse<TResult> {
  status_code?: number;
  status_message?: string;
  tasks?: Array<RawTaskResponse<TResult>> | null;
}

/**
 * Real HTTP call to a DataForSEO Live endpoint (Basic Auth, one task per
 * call) with a timeout, and retry-with-backoff on 429/5xx. Never logs the
 * credentials or the Authorization header. Returns the task's raw `result`
 * array unprocessed -- shared by callDataForSeo (below, takes result[0] --
 * matches every endpoint used so far, where result[0] is a single summary/
 * wrapper object) and callDataForSeoList (takes the whole array -- needed
 * for endpoints like Keywords Data search_volume/live, where DataForSEO
 * returns one array element per keyword directly in `result`, with no
 * wrapper object). Extracting this shared core changes no observable
 * behavior for either existing caller.
 */
async function executeDataForSeoTask<TResult>(path: string, task: Record<string, unknown>): Promise<{ items: Array<TResult | null>; cost: number }> {
  const { login, password } = requireCredentials();
  if (!rateLimit(SELF_THROTTLE_KEY, SELF_THROTTLE_LIMIT, SELF_THROTTLE_WINDOW_MS)) {
    throw new DataForSeoRateLimitError();
  }

  const authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  const url = `${baseUrl()}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw timedOut
        ? new DataForSeoApiError(0, `DataForSEO request timed out after ${REQUEST_TIMEOUT_MS}ms.`)
        : new DataForSeoApiError(0, `DataForSEO request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timeout);

    if (res.status === 429) {
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new DataForSeoApiError(429, "DataForSEO API rate limit exceeded.");
    }

    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new DataForSeoApiError(res.status, `DataForSEO API failed: ${res.status} ${res.statusText} -- ${body}`);
    }

    let parsed: RawApiResponse<TResult>;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      throw new DataForSeoApiError(res.status, "DataForSEO returned a response that could not be parsed as JSON.");
    }

    if (parsed.status_code !== 20000) {
      throw new DataForSeoApiError(parsed.status_code ?? 0, `DataForSEO API error: ${parsed.status_message ?? "unknown error"}`);
    }

    const task0 = parsed.tasks?.[0];
    if (!task0) {
      throw new DataForSeoApiError(0, "DataForSEO returned no task in its response (malformed response).");
    }
    if (task0.status_code !== undefined && task0.status_code !== 20000) {
      throw new DataForSeoApiError(task0.status_code, `DataForSEO task error: ${task0.status_message ?? "unknown error"}`);
    }

    return { items: task0.result ?? [], cost: task0.cost ?? 0 };
  }
  throw new DataForSeoApiError(0, "DataForSEO request failed after retries.");
}

/** Takes only the first result element -- matches every endpoint used so far, where DataForSEO wraps a single summary/items object at result[0]. Behavior-identical to the pre-refactor implementation. */
async function callDataForSeo<TResult>(path: string, task: Record<string, unknown>): Promise<{ result: TResult; cost: number }> {
  const { items, cost } = await executeDataForSeoTask<TResult>(path, task);
  const result = items[0];
  if (!result) {
    // A genuinely empty result (e.g. no data for this target) is not an error.
    return { result: null as TResult, cost };
  }
  return { result, cost };
}

/** Takes the whole result array -- for endpoints (e.g. Keywords Data search_volume/live) where DataForSEO returns one element per input item directly in `result`, with no wrapper object. */
async function callDataForSeoList<TResult>(path: string, task: Record<string, unknown>): Promise<{ results: TResult[]; cost: number }> {
  const { items, cost } = await executeDataForSeoTask<TResult>(path, task);
  return { results: items.filter((item): item is TResult => item !== null), cost };
}

function requireTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) throw new DataForSeoValidationError("target must not be empty.");
  return trimmed;
}

/**
 * Cost gate for Keyword Data/Labs calls only (see DataForSeoProductionBlockedError).
 * Sandbox is always allowed (free, dummy data). A real, billed production
 * call requires DATAFORSEO_KEYWORDS_ALLOW_PRODUCTION=true in addition to
 * valid credentials -- unlike Backlinks, which has no such gate.
 */
function assertKeywordsProductionAllowed(): void {
  if (isSandboxMode()) return;
  if (process.env.DATAFORSEO_KEYWORDS_ALLOW_PRODUCTION === "true") return;
  throw new DataForSeoProductionBlockedError();
}

export interface DataForSeoConnectionStatus {
  readonly configured: boolean;
  readonly sandbox: boolean;
}

/**
 * DataForSEO isn't a per-user OAuth connection or a free-to-call API like
 * Pixabay -- it's a single server-side credential pair from
 * DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD, and every real (non-sandbox) call
 * costs money. So unlike server/pixabay.ts's getConnectionStatus(), this
 * deliberately does NOT make a real API call to verify the credentials --
 * it only reports whether they're configured. Verify connectivity for real
 * by calling getBacklinksSummary() explicitly (in sandbox mode, for free).
 */
export function getConnectionStatus(): DataForSeoConnectionStatus {
  return { configured: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD), sandbox: isSandboxMode() };
}

export type DataForSeoSerpCapabilityState = "not_configured" | "sandbox_only" | "production_opt_in_required" | "ready";

export interface DataForSeoSerpCapabilityStatus {
  readonly configured: boolean;
  readonly sandbox: boolean;
  /** DATAFORSEO_SERP_ALLOW_PRODUCTION=="true" -- the same explicit cost-gate opt-in src/agents/prospecting-agent/providers/dataforseo-guest-post-discovery-provider.ts itself enforces. */
  readonly productionAllowed: boolean;
  /** True only when a real, live (non-Sandbox) SERP search + page-fetch would actually be attempted for guest-post discovery. Sandbox alone returns DataForSEO's own dummy data -- never real evidence -- so it is deliberately NOT "ready" even though it is "configured". */
  readonly ready: boolean;
  /** A single, UI-renderable summary of the same boolean logic above -- computed here (not re-derived in the UI) so Settings -> Integrations and web/src/server/backend/prospecting.ts's resolveProspectDiscoveryProvider() can never disagree about what state the capability is in. */
  readonly state: DataForSeoSerpCapabilityState;
}

/**
 * The single source of truth for the Prospecting Agent's real SERP / Guest
 * Posting Discovery capability -- reused by BOTH Settings -> Integrations
 * (so the UI never claims "Ready" for a capability that isn't) AND
 * web/src/server/backend/prospecting.ts's resolveProspectDiscoveryProvider()
 * (so the live agent's actual provider choice can never diverge from what
 * the UI reports). Reuses the SAME DATAFORSEO_LOGIN/PASSWORD/SANDBOX
 * connection every other DataForSEO capability on this page already uses --
 * this is not a second integration.
 */
export function getSerpCapabilityStatus(): DataForSeoSerpCapabilityStatus {
  const configured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const sandbox = isSandboxMode();
  const productionAllowed = process.env.DATAFORSEO_SERP_ALLOW_PRODUCTION === "true";
  const ready = configured && !sandbox && productionAllowed;

  let state: DataForSeoSerpCapabilityState;
  if (!configured) {
    state = "not_configured";
  } else if (ready) {
    state = "ready";
  } else if (sandbox) {
    state = "sandbox_only";
  } else {
    state = "production_opt_in_required";
  }

  return { configured, sandbox, productionAllowed, ready, state };
}

export interface DataForSeoBacklinksSummary {
  readonly target: string;
  /** DataForSEO's own target/domain rank (0-100 scale) -- NOT Moz Domain Authority or Ahrefs Domain Rating. `null` if DataForSEO didn't return one. */
  readonly rank: number | null;
  readonly backlinks: number | null;
  readonly referringDomains: number | null;
  readonly referringMainDomains: number | null;
  readonly referringDomainsNofollow: number | null;
  readonly brokenBacklinks: number | null;
  /** DataForSEO's own aggregate spam-risk score (0-100) across all backlinks -- not a certified toxicity verdict. `null` if unavailable. */
  readonly backlinksSpamScore: number | null;
  /** DataForSEO's own average spam-risk score (0-100) for the target itself. `null` if unavailable. */
  readonly targetSpamScore: number | null;
  readonly costUsd: number;
  readonly source: "dataforseo";
  readonly sandbox: boolean;
  readonly retrievedAt: string;
}

interface RawSummaryResult {
  target?: string;
  rank?: number;
  backlinks?: number;
  broken_backlinks?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_domains_nofollow?: number;
  backlinks_spam_score?: number;
  target_spam_score?: number;
}

/** Real call to Backlinks Summary Live (POST /v3/backlinks/summary/live) -- target-level totals and rank. */
export async function getBacklinksSummary(target: string): Promise<DataForSeoBacklinksSummary> {
  const cleanTarget = requireTarget(target);
  const { result, cost } = await callDataForSeo<RawSummaryResult>("/backlinks/summary/live", {
    target: cleanTarget,
    rank_scale: "one_hundred",
  });

  return {
    target: cleanTarget,
    rank: result?.rank ?? null,
    backlinks: result?.backlinks ?? null,
    referringDomains: result?.referring_domains ?? null,
    referringMainDomains: result?.referring_main_domains ?? null,
    referringDomainsNofollow: result?.referring_domains_nofollow ?? null,
    brokenBacklinks: result?.broken_backlinks ?? null,
    backlinksSpamScore: result?.backlinks_spam_score ?? null,
    targetSpamScore: result?.target_spam_score ?? null,
    costUsd: cost,
    source: "dataforseo",
    sandbox: isSandboxMode(),
    retrievedAt: new Date().toISOString(),
  };
}

export interface DataForSeoBacklinkItem {
  readonly domainFrom: string | null;
  readonly urlFrom: string | null;
  readonly urlTo: string | null;
  readonly anchorText: string | null;
  readonly dofollow: boolean;
  /** DataForSEO's own rank for the referring domain (0-100 scale) -- NOT Moz DA / Ahrefs DR. `null` if unavailable. */
  readonly domainFromRank: number | null;
  /** DataForSEO's own per-backlink spam-risk score (0-100) -- not a certified toxicity verdict. `null` if unavailable. */
  readonly backlinkSpamScore: number | null;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  readonly isNew: boolean;
  readonly isLost: boolean;
}

export interface DataForSeoBacklinksResult {
  readonly target: string;
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly items: readonly DataForSeoBacklinkItem[];
  readonly costUsd: number;
  readonly source: "dataforseo";
  readonly sandbox: boolean;
  readonly retrievedAt: string;
}

export interface GetBacklinksOptions {
  /** "as_is" (every backlink), "one_per_domain" (one row per referring domain), "one_per_anchor". Default: "one_per_domain" -- matches this codebase's referring-domain-oriented use (server/google-sheets.ts-style least-surprise default), not a raw firehose. */
  mode?: "as_is" | "one_per_domain" | "one_per_anchor";
  /** Default 100, hard-capped at 1000 (DataForSEO's own max) to bound response size and cost. */
  limit?: number;
  offset?: number;
  dofollowOnly?: boolean;
}

interface RawBacklinkItem {
  domain_from?: string;
  url_from?: string;
  url_to?: string;
  anchor?: string;
  dofollow?: boolean;
  domain_from_rank?: number;
  backlink_spam_score?: number;
  first_seen?: string;
  last_seen?: string;
  is_new?: boolean;
  is_lost?: boolean;
}

interface RawBacklinksResult {
  target?: string;
  total_count?: number;
  items_count?: number;
  items?: RawBacklinkItem[];
}

/** Real call to Backlinks Live (POST /v3/backlinks/backlinks/live) -- per-link detail: referring domain, anchor text, dofollow/nofollow, link rank, spam score. */
export async function getBacklinks(target: string, options: GetBacklinksOptions = {}): Promise<DataForSeoBacklinksResult> {
  const cleanTarget = requireTarget(target);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const offset = Math.max(options.offset ?? 0, 0);

  const task: Record<string, unknown> = {
    target: cleanTarget,
    mode: options.mode ?? "one_per_domain",
    limit,
    offset,
    rank_scale: "one_hundred",
    backlinks_status_type: "live",
  };
  if (options.dofollowOnly) {
    task.filters = ["dofollow", "=", true];
  }

  const { result, cost } = await callDataForSeo<RawBacklinksResult>("/backlinks/backlinks/live", task);

  const items: DataForSeoBacklinkItem[] = (result?.items ?? []).map((item) => ({
    domainFrom: item.domain_from ?? null,
    urlFrom: item.url_from ?? null,
    urlTo: item.url_to ?? null,
    anchorText: item.anchor ?? null,
    dofollow: item.dofollow ?? false,
    domainFromRank: item.domain_from_rank ?? null,
    backlinkSpamScore: item.backlink_spam_score ?? null,
    firstSeen: item.first_seen ?? null,
    lastSeen: item.last_seen ?? null,
    isNew: item.is_new ?? false,
    isLost: item.is_lost ?? false,
  }));

  return {
    target: cleanTarget,
    totalCount: result?.total_count ?? 0,
    itemsCount: result?.items_count ?? items.length,
    items,
    costUsd: cost,
    source: "dataforseo",
    sandbox: isSandboxMode(),
    retrievedAt: new Date().toISOString(),
  };
}

// -- Keyword Data / Labs (search volume + keyword difficulty) -----------
//
// Two endpoints, matching the KeywordDataProvider seam in
// src/agents/keyword-research-agent (searchVolume + difficulty) and nothing
// else from DataForSEO's much larger Keywords Data/Labs catalog:
//   - POST /v3/keywords_data/google_ads/search_volume/live -- real, Google
//     Ads-sourced monthly search volume + competition.
//   - POST /v3/dataforseo_labs/google/bulk_keyword_difficulty/live -- real
//     keyword_difficulty (0-100). This is DataForSEO Labs' OWN computed
//     model, not a universal/standardized "keyword difficulty" concept and
//     not Moz/Ahrefs/SEMrush's own difficulty scores -- kept under its own
//     documented field name throughout, never relabeled generically.
//
// Both require a location (search volume is market-specific) -- gated
// behind assertKeywordsProductionAllowed() so a real, billed call can only
// happen with DATAFORSEO_SANDBOX=true or an explicit, separate opt-in;
// Sandbox is always allowed and free.

const DEFAULT_LOCATION_CODE = 2840; // United States -- DataForSEO's own numeric code
const DEFAULT_LANGUAGE_CODE = "en";

export interface KeywordDataOptions {
  /** DataForSEO numeric location code. Defaults to 2840 (United States) when omitted -- a disclosed default, not a silent guess; see file header comment. */
  locationCode?: number;
  /** Defaults to "en" when omitted. */
  languageCode?: string;
}

export interface DataForSeoSearchVolumeResult {
  readonly keyword: string;
  /** Real monthly average search volume, as reported by Google Ads via DataForSEO. `null` if DataForSEO returned none for this keyword. */
  readonly searchVolume: number | null;
  /** Google Ads' own competition band ("HIGH" | "MEDIUM" | "LOW"), as reported -- never inferred locally. `null` if unavailable. */
  readonly competition: string | null;
  /** Google Ads' own competition index (0-100), as reported. `null` if unavailable. */
  readonly competitionIndex: number | null;
  readonly costUsd: number;
  readonly source: "dataforseo";
  readonly sandbox: boolean;
  readonly retrievedAt: string;
}

interface RawSearchVolumeItem {
  keyword?: string;
  search_volume?: number;
  competition?: string;
  competition_index?: number;
}

function requireKeywords(keywords: readonly string[]): string[] {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (cleaned.length === 0) throw new DataForSeoValidationError("keywords must contain at least one non-empty value.");
  if (cleaned.length > 1000) throw new DataForSeoValidationError("keywords must not exceed 1000 entries (DataForSEO's own limit).");
  return cleaned;
}

/** Real call to Google Ads Search Volume Live (POST /v3/keywords_data/google_ads/search_volume/live). Sandbox-only by default -- see assertKeywordsProductionAllowed(). */
export async function getSearchVolume(keywords: readonly string[], options: KeywordDataOptions = {}): Promise<DataForSeoSearchVolumeResult[]> {
  assertKeywordsProductionAllowed();
  const cleanKeywords = requireKeywords(keywords);

  const { results, cost } = await callDataForSeoList<RawSearchVolumeItem>("/keywords_data/google_ads/search_volume/live", {
    keywords: cleanKeywords,
    location_code: options.locationCode ?? DEFAULT_LOCATION_CODE,
    language_code: options.languageCode ?? DEFAULT_LANGUAGE_CODE,
  });

  const sandbox = isSandboxMode();
  const retrievedAt = new Date().toISOString();
  return results.map((item) => ({
    keyword: item.keyword ?? "",
    searchVolume: item.search_volume ?? null,
    competition: item.competition ?? null,
    competitionIndex: item.competition_index ?? null,
    costUsd: cost,
    source: "dataforseo" as const,
    sandbox,
    retrievedAt,
  }));
}

export interface DataForSeoKeywordDifficultyResult {
  readonly keyword: string;
  /** DataForSEO Labs' own computed keyword_difficulty (0-100, logarithmic scale per DataForSEO's docs) -- not a universal/generic difficulty metric and not any third-party tool's score. `null` if DataForSEO returned none for this keyword. */
  readonly keywordDifficulty: number | null;
  readonly costUsd: number;
  readonly source: "dataforseo";
  readonly sandbox: boolean;
  readonly retrievedAt: string;
}

interface RawKeywordDifficultyItem {
  keyword?: string;
  keyword_difficulty?: number;
}

interface RawKeywordDifficultyResult {
  items?: RawKeywordDifficultyItem[];
}

/** Real call to DataForSEO Labs Bulk Keyword Difficulty Live (POST /v3/dataforseo_labs/google/bulk_keyword_difficulty/live). Sandbox-only by default -- see assertKeywordsProductionAllowed(). */
export async function getKeywordDifficulty(keywords: readonly string[], options: KeywordDataOptions = {}): Promise<DataForSeoKeywordDifficultyResult[]> {
  assertKeywordsProductionAllowed();
  const cleanKeywords = requireKeywords(keywords);

  const { result, cost } = await callDataForSeo<RawKeywordDifficultyResult>("/dataforseo_labs/google/bulk_keyword_difficulty/live", {
    keywords: cleanKeywords,
    location_code: options.locationCode ?? DEFAULT_LOCATION_CODE,
    language_code: options.languageCode ?? DEFAULT_LANGUAGE_CODE,
  });

  const sandbox = isSandboxMode();
  const retrievedAt = new Date().toISOString();
  return (result?.items ?? []).map((item) => ({
    keyword: item.keyword ?? "",
    keywordDifficulty: item.keyword_difficulty ?? null,
    costUsd: cost,
    source: "dataforseo" as const,
    sandbox,
    retrievedAt,
  }));
}

// -- Competitor Domain Discovery (DataForSEO Labs) -----------------------
//
// COMPETITOR INTELLIGENCE WIRING (2026-09-03): the ONE DataForSEO endpoint this codebase's Competitor
// Intelligence orchestration (server/backend/competitor-intelligence.ts) needs to actually DISCOVER who a
// target's real organic-search competitors are: POST /v3/dataforseo_labs/google/competitors_domain/live --
// real domains that organically rank for overlapping keywords with `target`, ordered by DataForSEO's own
// relevance ranking. This is genuine competitor DISCOVERY (who competes with us) -- deliberately distinct
// from Domain Intersection (comparing two ALREADY-KNOWN domains, which this codebase has no use for) and
// from every other Labs/Backlinks endpoint this file's own header already says is out of scope. Reuses the
// EXACT SAME cost gate as the other Keyword Data/Labs endpoints above (assertKeywordsProductionAllowed()) --
// never a second, duplicate gate -- and the same executeDataForSeoTask() core every endpoint in this file
// shares, so credentials, retry/backoff, timeout, and the self-throttle bucket are all identical.
//
// FIELD-MAPPING HONESTY NOTE: the response shape below (`result[0].items[]`, with per-item `target`/
// `avg_position`/`intersections`) mirrors this SAME file's own getKeywordDifficulty() above -- a sibling
// dataforseo_labs endpoint that wraps its array behind a `result[0]` metadata object via callDataForSeo(),
// rather than search_volume/live's flat-array-in-`result` shape (callDataForSeoList()) -- because Labs
// endpoints in this codebase consistently use the wrapped form. This was implemented and verified entirely
// against LOCAL, MOCKED responses (per the explicit zero-live-call constraint this feature was built
// under) -- it has not been exercised against a real DataForSEO response. Verify against one real Sandbox
// call (DATAFORSEO_SANDBOX=true, free) before the first live use; if a field name differs, the
// corresponding output field simply stays `null` (this module's own "never fabricate, honestly report
// unavailable" contract), never a crash.

export interface DataForSeoCompetitorDomain {
  readonly domain: string;
  /** DataForSEO's own average SERP position across the intersecting keyword set -- lower is generally better. `null` if unavailable. Never a generic "ranking score" -- kept under DataForSEO's own field name/semantics. */
  readonly avgPosition: number | null;
  /** DataForSEO's own count of overlapping ranked keywords between the target and this competitor domain. `null` if unavailable. */
  readonly intersections: number | null;
  readonly costUsd: number;
  readonly source: "dataforseo";
  readonly sandbox: boolean;
  readonly retrievedAt: string;
}

interface RawCompetitorDomainItem {
  target?: string;
  avg_position?: number;
  intersections?: number;
}

interface RawCompetitorsDomainResult {
  items?: RawCompetitorDomainItem[];
}

export interface GetCompetitorDomainsOptions {
  locationCode?: number;
  languageCode?: string;
  /** Defaults to 10, hard-capped at 50 to bound response size/cost -- this codebase only ever needs a small, bounded shortlist for real HTML fetching afterward, never an uncontrolled fan-out. */
  limit?: number;
}

/** Real call to DataForSEO Labs Competitors Domain Live (POST /v3/dataforseo_labs/google/competitors_domain/live). Sandbox-only by default -- see assertKeywordsProductionAllowed(). Never returns `target` itself (a domain cannot be its own competitor) or a blank domain. */
export async function getCompetitorDomains(target: string, options: GetCompetitorDomainsOptions = {}): Promise<DataForSeoCompetitorDomain[]> {
  assertKeywordsProductionAllowed();
  const cleanTarget = requireTarget(target);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);

  const { result, cost } = await callDataForSeo<RawCompetitorsDomainResult>("/dataforseo_labs/google/competitors_domain/live", {
    target: cleanTarget,
    location_code: options.locationCode ?? DEFAULT_LOCATION_CODE,
    language_code: options.languageCode ?? DEFAULT_LANGUAGE_CODE,
    limit,
  });

  const sandbox = isSandboxMode();
  const retrievedAt = new Date().toISOString();
  return (result?.items ?? [])
    .filter((item): item is RawCompetitorDomainItem & { target: string } => Boolean(item.target?.trim()) && item.target!.trim().toLowerCase() !== cleanTarget.toLowerCase())
    .map((item) => ({
      domain: item.target.trim(),
      avgPosition: item.avg_position ?? null,
      intersections: item.intersections ?? null,
      costUsd: cost,
      source: "dataforseo" as const,
      sandbox,
      retrievedAt,
    }));
}
