// Real Bing Webmaster Tools OAuth 2.0 client + REST/JSON API calls --
// mirrors server/google-search-console.ts's exact structure (OAuth
// URL-building, code exchange, refresh, revoke, encrypted token storage via
// server/credential-encryption.ts) so this integration follows the SAME
// established production pattern rather than inventing a new one.
//
// PROTOCOL (verified against Microsoft's current, live documentation --
// https://learn.microsoft.com/en-us/bingwebmaster/oauth2 and
// https://learn.microsoft.com/en-us/bingwebmaster/api-protocols, both
// fetched directly before writing this file): Bing Webmaster's legacy SOAP
// and POX APIs retire August 31, 2026 -- this uses the REST/JSON protocol
// only (`https://ssl.bing.com/webmaster/api.svc/json/{Method}`), and OAuth
// 2.0 (the documented "[Recommended]" method) rather than the legacy
// per-user apikey query-parameter method. Every method name and response
// field below is taken verbatim from Microsoft's own .NET API reference
// (learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi*),
// which documents the real JSON request/response shape for each REST
// method -- never invented.
//
// SCOPE (least privilege, Phase 2/7 of this task): requests only
// `Webmaster.read` -- read access to the user's Bing Webmaster data. This
// integration never writes anything to Bing Webmaster (no SubmitUrl,
// SubmitFeed, SubmitContent, crawl-setting changes, site/role management --
// all real, documented, but write-scoped (`Webmaster.manage`) and out of
// scope for a read-only reporting integration, exactly matching Google
// Search Console's own `webmasters.readonly` scope in this same codebase).
//
// UNLIKE Google, an OAuth client (client ID/secret) for Bing Webmaster is
// registered per BING WEBMASTER ACCOUNT (Bing Webmaster Tools -> Settings ->
// API Access -> OAuth Client), not via a shared developer console project --
// this cannot be provisioned by this codebase; the user must register it
// themselves and supply BING_CLIENT_ID/BING_CLIENT_SECRET (see .env.example).

import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { encryptSecret, decryptSecret } from "@/server/credential-encryption";

// CROSS-ORIGIN CALLBACK FIX (2026-08-27): see BingOAuthState's own schema
// comment for the real, live-confirmed defect this closes -- a cookie-based
// CSRF/identity check (the original design, matching every other OAuth
// integration in this codebase) cannot survive the callback arriving on a
// different browser origin than the one that set the cookie, which is
// exactly what happens whenever local development routes Bing's callback
// through a temporary public HTTPS tunnel (required because Bing rejects a
// localhost redirect URI outright -- see this file's header above). 10
// minutes -- same window every other short-lived OAuth artifact in this
// codebase uses (the `gsc_oauth_state`/`bing_oauth_state`-style state
// cookies' own maxAge: 600).
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Creates a real, single-use, server-side record binding a random state value to `userId` -- called only from the /connect route, where a real, same-origin session is reliably present. Returns the state value to send to Bing. */
export async function createOAuthState(userId: string): Promise<string> {
  const state = randomBytes(24).toString("hex");
  await db.bingOAuthState.create({ data: { state, userId, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) } });
  return state;
}

/**
 * Resolves and consumes a real, previously-created OAuth state -- the
 * cross-origin-safe replacement for a session cookie at the callback step
 * (see this file's own header comment). Returns the real userId only for a
 * state that exists, has not already been used, and has not expired;
 * marks it used (never deletes -- keeps a real audit trail, same convention
 * as PasswordResetToken.usedAt) so a single state value can never be
 * replayed to attach a second, unrelated connection.
 */
export async function consumeOAuthState(state: string): Promise<string | null> {
  const record = await db.bingOAuthState.findUnique({ where: { state } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return null;
  }
  await db.bingOAuthState.update({ where: { state }, data: { usedAt: new Date() } });
  return record.userId;
}

const AUTH_URL = "https://www.bing.com/webmasters/oauth/authorize";
const TOKEN_URL = "https://www.bing.com/webmasters/oauth/token";
const API_BASE = "https://ssl.bing.com/webmaster/api.svc/json";
// Read-only scope -- see this file's own header on why webmaster.manage
// (write access) is deliberately never requested. Lowercase (2026-08-27):
// Microsoft's own oauth2 docs are internally inconsistent -- the
// "Authorization Scopes" reference section lists "Webmaster.read"/
// "Webmaster.manage" (Title Case), but the SAME page's own worked, literal
// example request in "Step 3" uses lowercase ("scope=webmaster.manage").
// A live attempt with the Title Case value was rejected by Bing's real
// OAuth server with `error=invalid_scope` / `error_description="'' scopes
// aren't supported."`; switching to the documented worked-example's exact
// casing is the untested next step -- see this project's own diagnosis
// notes for the two aren't-yet-empirically-confirmed alternatives if this
// doesn't resolve it (e.g. the scope not being granted to this specific
// OAuth Client on Bing's side).
const SCOPE = "webmaster.read";
const REQUEST_TIMEOUT_MS = 15_000;

export class BingWebmasterNotConnectedError extends Error {
  constructor() {
    super("No Bing Webmaster connection exists for this user.");
    this.name = "BingWebmasterNotConnectedError";
  }
}

/** Authentication failure -- the stored token is invalid, revoked, or the refresh itself failed (HTTP 401 from Bing). Never includes the token value. */
export class BingWebmasterAuthError extends Error {
  constructor(detail: string) {
    super(`Bing Webmaster authorization failed or was revoked: ${detail}`);
    this.name = "BingWebmasterAuthError";
  }
}

export class BingWebmasterRateLimitError extends Error {
  constructor() {
    super("Bing Webmaster API rate limit exceeded -- please try again shortly.");
    this.name = "BingWebmasterRateLimitError";
  }
}

/** Real, non-2xx API failure -- carries the real HTTP status and (non-secret) response body for diagnosis. Never includes the access token. */
export class BingWebmasterApiError extends Error {
  readonly status: number;
  constructor(status: number, method: string, body: string) {
    super(`Bing Webmaster API call to ${method} failed: HTTP ${status} -- ${body}`);
    this.name = "BingWebmasterApiError";
    this.status = status;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

// ISOLATED REDIRECT URI (2026-08-27): Bing Webmaster's own OAuth Client
// registration form rejects `localhost` outright (both http and https) --
// unlike Google/GitHub/NextAuth in this same codebase, which all accept a
// plain http://localhost:3000 callback. During local development this means
// Bing's redirect URI cannot be derived from NEXTAUTH_URL the way every
// other provider's is; doing so would either break Bing (localhost) or force
// NEXTAUTH_URL itself to a temporary public tunnel hostname, which would
// silently change every OTHER OAuth integration's (Google, GitHub) and
// NextAuth's own callback/cookie behavior -- explicitly ruled out.
// BING_OAUTH_REDIRECT_URI is a separate, Bing-only override: when set (e.g.
// to a temporary HTTPS tunnel URL during local dev, or a real production
// domain once ADASOS is actually deployed), it is used verbatim and NEVER
// touches NEXTAUTH_URL or any other integration. When unset, this falls back
// to the same NEXTAUTH_URL-derived convention every other integration uses
// (correct once ADASOS has a real deployed HTTPS domain, where Bing's own
// restriction no longer applies).
function redirectUri(): string {
  return process.env.BING_OAUTH_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/integrations/bing-webmaster/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.BING_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.BING_CLIENT_ID ?? "",
      client_secret: process.env.BING_CLIENT_SECRET ?? "",
      code,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Bing Webmaster token exchange failed: ${res.status} ${body}`);
  }
  return JSON.parse(body) as TokenResponse;
}

export async function saveConnection(userId: string, tokens: TokenResponse): Promise<void> {
  if (!tokens.refresh_token) {
    throw new Error("Bing Webmaster did not return a refresh_token.");
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const encryptedAccessToken = encryptSecret(tokens.access_token);
  const encryptedRefreshToken = encryptSecret(tokens.refresh_token);
  await db.bingWebmasterConnection.upsert({
    where: { userId },
    update: { encryptedAccessToken, encryptedRefreshToken, scope: SCOPE, expiresAt },
    create: { userId, encryptedAccessToken, encryptedRefreshToken, scope: SCOPE, expiresAt },
  });
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; connectedAt?: string }> {
  const connection = await db.bingWebmasterConnection.findUnique({ where: { userId }, select: { updatedAt: true } });
  return connection ? { connected: true, connectedAt: connection.updatedAt.toISOString() } : { connected: false };
}

/** Real, best-effort disconnect. Bing Webmaster's OAuth implementation documents no token-revocation endpoint (unlike Google's /revoke) -- deleting the stored, encrypted token locally is the real, complete action available; the access/refresh token simply expires naturally on Bing's side thereafter. */
export async function disconnect(userId: string): Promise<void> {
  await db.bingWebmasterConnection.deleteMany({ where: { userId } });
}

/** Returns a usable access token for `userId`'s Bing Webmaster connection, refreshing it first if expired or about to expire. Returns null if there's no connection. Throws BingWebmasterAuthError if the refresh itself is rejected (revoked/invalid grant) -- callers must not treat that the same as "not connected". */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await db.bingWebmasterConnection.findUnique({ where: { userId } });
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.encryptedAccessToken);
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.BING_CLIENT_ID ?? "",
      client_secret: process.env.BING_CLIENT_SECRET ?? "",
      refresh_token: decryptSecret(connection.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new BingWebmasterAuthError(`refresh rejected (HTTP ${res.status}) -- the user likely needs to reconnect.`);
    }
    throw new Error(`Bing Webmaster token refresh failed: ${res.status} ${body}`);
  }
  const refreshed = JSON.parse(body) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.bingWebmasterConnection.update({ where: { userId }, data: { encryptedAccessToken: encryptSecret(refreshed.access_token), expiresAt } });
  return refreshed.access_token;
}

/**
 * Real GET call to a Bing Webmaster REST/JSON method
 * (https://ssl.bing.com/webmaster/api.svc/json/{method}), authenticated via
 * the OAuth Bearer token (never the legacy apikey query parameter -- see
 * this file's own header). Unwraps the API's own `{"d": ...}` envelope
 * (a real, documented artifact of the underlying WCF Data Services
 * implementation, confirmed in every JSON response sample in Microsoft's
 * reference) and classifies failures into real, specific error types --
 * never a generic "request failed".
 */
async function callBingApi<T>(accessToken: string, method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) qs.set(key, String(value));
  const url = `${API_BASE}/${method}${qs.toString() ? `?${qs.toString()}` : ""}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    throw new Error(timedOut ? `Bing Webmaster API call to ${method} timed out after ${REQUEST_TIMEOUT_MS}ms.` : `Bing Webmaster API call to ${method} failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  const body = await res.text();
  if (res.status === 401) throw new BingWebmasterAuthError(`HTTP 401 calling ${method} -- the stored access token was rejected.`);
  if (res.status === 429) throw new BingWebmasterRateLimitError();
  if (!res.ok) throw new BingWebmasterApiError(res.status, method, body);

  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Bing Webmaster API call to ${method} returned a malformed (non-JSON) response.`);
  }
  const envelope = parsed as { d?: T };
  if (!("d" in (envelope as object))) {
    throw new Error(`Bing Webmaster API call to ${method} returned an unexpected response shape (missing "d" envelope).`);
  }
  return envelope.d as T;
}

/** Parses Bing's real .NET AJAX date format ("/Date(1316156400000-0700)/") into an ISO 8601 string. Never guesses a date from context -- returns null (never fabricated) if the field is missing or doesn't match the documented format. */
export function parseBingDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(raw);
  if (!match?.[1]) return null;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export interface BingSite {
  readonly url: string;
  readonly isVerified: boolean;
}

/** Real call to GetUserSites -- every verified/unverified site Bing Webmaster has on file for this account. Field names (Url, IsVerified) taken verbatim from Microsoft's documented JSON response sample. */
export async function listSites(userId: string): Promise<BingSite[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const sites = await callBingApi<Array<{ Url: string; IsVerified: boolean }>>(accessToken, "GetUserSites");
  return (sites ?? []).map((s) => ({ url: s.Url, isVerified: s.IsVerified }));
}

export async function getVerifiedSites(userId: string): Promise<BingSite[]> {
  return (await listSites(userId)).filter((s) => s.isVerified);
}

/** Resolves which verified site this user's Bing Webmaster calls should target, and persists the choice -- same auto-pick-first-verified, re-validate-live-every-time convention as google-search-console.ts's getOrSelectPrimarySite(). Returns null if there is no connection, or no verified site exists yet. */
export async function getOrSelectPrimarySite(userId: string): Promise<string | null> {
  const connection = await db.bingWebmasterConnection.findUnique({ where: { userId }, select: { selectedSiteUrl: true } });
  if (!connection) return null;

  const verified = await getVerifiedSites(userId);
  if (verified.length === 0) {
    if (connection.selectedSiteUrl !== null) {
      await db.bingWebmasterConnection.update({ where: { userId }, data: { selectedSiteUrl: null } });
    }
    return null;
  }

  if (connection.selectedSiteUrl && verified.some((s) => s.url === connection.selectedSiteUrl)) {
    return connection.selectedSiteUrl;
  }

  const primary = verified[0]!.url;
  await db.bingWebmasterConnection.update({ where: { userId }, data: { selectedSiteUrl: primary } });
  return primary;
}

export async function setSelectedSite(userId: string, siteUrl: string): Promise<void> {
  const verified = await getVerifiedSites(userId);
  if (!verified.some((s) => s.url === siteUrl)) {
    throw new Error(`"${siteUrl}" is not a verified Bing Webmaster site for this account.`);
  }
  await db.bingWebmasterConnection.update({ where: { userId }, data: { selectedSiteUrl: siteUrl } });
}

export interface BingQueryStat {
  readonly query: string;
  readonly date: string | null;
  readonly clicks: number;
  readonly impressions: number;
  readonly avgClickPosition: number;
  readonly avgImpressionPosition: number;
}

/** Real call to GetQueryStats(siteUrl) -- "detailed traffic statistics for top queries", updated weekly per Microsoft's own documented remarks. Field names taken verbatim from the documented JSON response sample. */
export async function getQueryStats(userId: string, siteUrl: string): Promise<BingQueryStat[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const rows = await callBingApi<Array<{ Query: string; Date: string; Clicks: number; Impressions: number; AvgClickPosition: number; AvgImpressionPosition: number }>>(accessToken, "GetQueryStats", { siteUrl });
  return (rows ?? []).map((r) => ({
    query: r.Query,
    date: parseBingDate(r.Date),
    clicks: r.Clicks,
    impressions: r.Impressions,
    avgClickPosition: r.AvgClickPosition,
    avgImpressionPosition: r.AvgImpressionPosition,
  }));
}

export interface BingRankAndTrafficStat {
  readonly date: string | null;
  readonly clicks: number;
  readonly impressions: number;
}

/** Real call to GetRankAndTrafficStats(siteUrl) -- daily site-wide clicks/impressions across Web, Chat, News, Images, Videos, and Knowledge Panel (per Microsoft's own documented remarks, effective March 24, 2023 onward). */
export async function getRankAndTrafficStats(userId: string, siteUrl: string): Promise<BingRankAndTrafficStat[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const rows = await callBingApi<Array<{ Date: string; Clicks: number; Impressions: number }>>(accessToken, "GetRankAndTrafficStats", { siteUrl });
  return (rows ?? []).map((r) => ({ date: parseBingDate(r.Date), clicks: r.Clicks, impressions: r.Impressions }));
}

export interface BingCrawlStat {
  readonly date: string | null;
  readonly crawledPages: number;
  readonly inIndex: number;
  readonly inLinks: number;
  readonly crawlErrors: number;
  readonly code2xx: number;
  readonly code4xx: number;
  readonly code5xx: number;
  readonly blockedByRobotsTxt: number;
}

/** Real call to GetCrawlStats(siteUrl) -- daily crawl statistics for the last 6 months, per Microsoft's own documented return-value description. */
export async function getCrawlStats(userId: string, siteUrl: string): Promise<BingCrawlStat[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const rows = await callBingApi<
    Array<{ Date: string; CrawledPages: number; InIndex: number; InLinks: number; CrawlErrors: number; Code2xx: number; Code4xx: number; Code5xx: number; BlockedByRobotsTxt: number }>
  >(accessToken, "GetCrawlStats", { siteUrl });
  return (rows ?? []).map((r) => ({
    date: parseBingDate(r.Date),
    crawledPages: r.CrawledPages,
    inIndex: r.InIndex,
    inLinks: r.InLinks,
    crawlErrors: r.CrawlErrors,
    code2xx: r.Code2xx,
    code4xx: r.Code4xx,
    code5xx: r.Code5xx,
    blockedByRobotsTxt: r.BlockedByRobotsTxt,
  }));
}

export interface BingLinkCounts {
  readonly links: ReadonlyArray<{ readonly url: string; readonly count: number }>;
  readonly totalPages: number;
}

/** Real call to GetLinkCounts(siteUrl, page) -- real inbound-link counts PER PAGE OF THE VERIFIED SITE, as seen by Bing's own crawler. This is the verified site's own real backlink data, not a third-party backlink index (Ahrefs/Semrush-style) and not competitor data -- see this module's own Phase 6 boundary note in bing-webmaster's documentation. */
export async function getLinkCounts(userId: string, siteUrl: string, page = 0): Promise<BingLinkCounts> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const result = await callBingApi<{ Links: Array<{ Url: string; Count: number }> | null; TotalPages: number }>(accessToken, "GetLinkCounts", { siteUrl, page });
  return { links: (result.Links ?? []).map((l) => ({ url: l.Url, count: l.Count })), totalPages: result.TotalPages };
}

export interface BingFeed {
  readonly url: string;
  readonly type: string;
  readonly status: string;
  readonly urlCount: number;
  readonly submitted: string | null;
  readonly lastCrawled: string | null;
}

/** Real call to GetFeeds(siteUrl) -- every sitemap/feed registered for the verified site, with Bing's own real crawl status for each. */
export async function getFeeds(userId: string, siteUrl: string): Promise<BingFeed[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new BingWebmasterNotConnectedError();
  const rows = await callBingApi<Array<{ Url: string; Type: string; Status: string; UrlCount: number; Submitted: string; LastCrawled: string }>>(accessToken, "GetFeeds", { siteUrl });
  return (rows ?? []).map((r) => ({
    url: r.Url,
    type: r.Type,
    status: r.Status,
    urlCount: r.UrlCount,
    submitted: parseBingDate(r.Submitted),
    lastCrawled: parseBingDate(r.LastCrawled),
  }));
}
