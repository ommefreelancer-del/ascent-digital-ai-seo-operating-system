// Server-side WordPress client, following this codebase's other external-API
// service module shape (server/google-sheets.ts, server/gmail.ts,
// server/pixabay.ts): one module owns the real HTTP calls, response
// normalization, and error handling; nothing else calls a WordPress site
// directly.
//
// Supports two independent connection providers, both stored in the same
// WordPressConnection row (see prisma/schema.prisma for the field split):
//
//  - "self-hosted": WordPress core's own Application Passwords feature
//    (WP 5.6+, no plugin required). The user is sent to their own site's
//    wp-admin/authorize-application.php, approves there, and WordPress
//    redirects back with `user_login`/`password` -- this module never
//    invents or generates that credential itself. Requests use HTTP Basic
//    Auth against {siteUrl}/wp-json/wp/v2.
//    https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
//
//  - "wordpress-com": WordPress.com's own OAuth2 (server/wordpress-com-oauth.ts),
//    which needs no site URL up front -- after the user approves on
//    wordpress.com, this module calls the real /me/sites endpoint to
//    discover which site(s) they manage and auto-selects the site when
//    there's exactly one (see exchangeWordPressComCodeAndSaveConnection).
//    Requests use an OAuth2 Bearer token against WordPress.com's own
//    wp/v2-compatible proxy (public-api.wordpress.com/wp/v2/sites/{id}),
//    confirmed live (HTTP 200, standard wp/v2 JSON shape) against a real
//    public WordPress.com site during development of this integration.
//    https://developer.wordpress.com/docs/oauth2/
//
// Both providers expose the same wp/v2-shaped REST surface, so every
// content operation below (listContent, createDraft, updateContent,
// publishPost, deleteContent, uploadMedia) is provider-agnostic -- only
// wpFetch()'s own URL/auth-header construction branches by provider.
//
// Every write that changes what's live (publishing, or updating an
// already-published post) is a separate, explicitly-named function so the
// API route layer can gate it behind explicit human approval (see
// api/integrations/wordpress/content/[id]/publish/route.ts) -- exactly like
// server/gmail.ts's sendDraft().

import { db } from "@/server/db";
import { buildWordPressComAuthUrl, exchangeWordPressComCodeForToken } from "@/server/wordpress-com-oauth";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

// A stable identifier for this application across every user/site
// connection, per the app_id parameter documented in WordPress's own
// Application Passwords integration guide -- not a secret.
const APP_ID = "b3f6a6d2-6f36-4e9a-9a3b-2b9d7a3d5c39";
const APP_NAME = "ADASOS";

const WPCOM_API_BASE = "https://public-api.wordpress.com";

export class WordPressNotConfiguredError extends Error {
  constructor() {
    super("No WordPress connection exists for this user.");
    this.name = "WordPressNotConfiguredError";
  }
}

export class WordPressSiteNotSelectedError extends Error {
  constructor() {
    super("A WordPress.com account is connected, but no site has been selected yet.");
    this.name = "WordPressSiteNotSelectedError";
  }
}

export class WordPressInvalidSiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressInvalidSiteError";
  }
}

export class WordPressAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressAuthError";
  }
}

export class WordPressPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordPressPermissionError";
  }
}

export class WordPressApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WordPressApiError";
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalizes a raw site URL into `<scheme>://<host>` with no trailing slash or path -- throws WordPressInvalidSiteError on a malformed URL. */
function normalizeSiteUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new WordPressInvalidSiteError(`"${raw}" is not a valid site URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WordPressInvalidSiteError(`"${raw}" must use http:// or https://.`);
  }
  return `${url.protocol}//${url.host}`;
}

function basicAuthHeader(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
}

interface WpRestIndex {
  name?: string;
  description?: string;
  url?: string;
  authentication?: {
    "application-passwords"?: { endpoints?: { authorization?: string } };
  };
}

/** Real GET to {siteUrl}/wp-json/ (WordPress's own REST API discovery index, unauthenticated) -- confirms this is a reachable self-hosted WordPress site and, per the real index shape, whether Application Passwords are available. */
async function discoverSite(siteUrl: string): Promise<WpRestIndex> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${siteUrl}/wp-json/`, { signal: controller.signal, headers: { Accept: "application/json" } });
  } catch (err) {
    clearTimeout(timeout);
    throw new WordPressInvalidSiteError(`Could not reach ${siteUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    throw new WordPressInvalidSiteError(`${siteUrl} did not return a valid WordPress REST API index (HTTP ${res.status}). Confirm the site URL and that the REST API is enabled.`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new WordPressInvalidSiteError(`${siteUrl} did not return a WordPress REST API index -- this may not be a WordPress site, or its REST API is disabled or blocked.`);
  }
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new WordPressInvalidSiteError(`${siteUrl} returned an invalid REST API index.`);
  }
}

async function verifyCredentials(siteUrl: string, username: string, appPassword: string): Promise<{ id: number; name: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
      signal: controller.signal,
      headers: { Authorization: basicAuthHeader(username, appPassword), Accept: "application/json" },
    });
  } catch (err) {
    clearTimeout(timeout);
    throw new WordPressApiError(0, `Could not reach ${siteUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timeout);

  const body = await res.text();
  if (res.status === 401) throw new WordPressAuthError(`WordPress rejected these credentials for ${siteUrl}.`);
  if (res.status === 403) throw new WordPressPermissionError(`This WordPress user does not have permission to use the REST API: ${body}`);
  if (!res.ok) throw new WordPressApiError(res.status, `Could not verify WordPress credentials: ${res.status} ${res.statusText} -- ${body}`);
  const data = body ? JSON.parse(body) : {};
  return { id: data.id, name: data.name ?? username };
}

export interface AuthorizeUrlResult {
  readonly authorizeUrl: string;
  readonly siteUrl: string;
}

/**
 * Builds the real wp-admin/authorize-application.php URL for a given
 * self-hosted site, after confirming (via the site's own REST index) that
 * it actually advertises Application Passwords support. Never generates or
 * guesses a credential -- the user completes this in their own browser, on
 * their own site, and WordPress alone decides what to send back.
 */
export async function buildAuthorizeUrl(rawSiteUrl: string, successUrl: string, rejectUrl: string): Promise<AuthorizeUrlResult> {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  const index = await discoverSite(siteUrl);
  const authorizationEndpoint = index.authentication?.["application-passwords"]?.endpoints?.authorization;
  if (!authorizationEndpoint) {
    throw new WordPressInvalidSiteError(
      `${siteUrl} does not advertise WordPress Application Passwords support (requires WordPress 5.6+, reachable over HTTPS or recognized as local). Connect manually with a generated Application Password, or connect via WordPress.com instead.`,
    );
  }
  const query = new URLSearchParams({ app_name: APP_NAME, app_id: APP_ID, success_url: successUrl, reject_url: rejectUrl });
  return { authorizeUrl: `${authorizationEndpoint}?${query.toString()}`, siteUrl };
}

/** Stores a self-hosted connection after the wp-admin authorize-application.php redirect, but only once the returned credentials are verified against a real API call -- never stores unverified input. */
export async function saveConnectionFromAuthorize(userId: string, rawSiteUrl: string, userLogin: string, password: string): Promise<void> {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  await verifyCredentials(siteUrl, userLogin, password);
  const site = await discoverSite(siteUrl).catch(() => null);
  const data = { provider: "self-hosted", siteUrl, username: userLogin, appPassword: password, siteName: site?.name ?? null, accessToken: null, wpcomSiteId: null };
  await db.wordPressConnection.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

/** Fallback path for self-hosted sites that don't expose the authorize-application.php redirect (or where it's blocked) -- the user pastes a username and an Application Password they generated themselves in wp-admin. Still verified against a real API call before being stored. */
export async function saveConnectionManually(userId: string, rawSiteUrl: string, username: string, appPassword: string): Promise<void> {
  const siteUrl = normalizeSiteUrl(rawSiteUrl);
  await verifyCredentials(siteUrl, username, appPassword);
  const site = await discoverSite(siteUrl).catch(() => null);
  const data = { provider: "self-hosted", siteUrl, username, appPassword, siteName: site?.name ?? null, accessToken: null, wpcomSiteId: null };
  await db.wordPressConnection.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}

// ---------------------------------------------------------------------------
// WordPress.com (OAuth2) connection lifecycle
// ---------------------------------------------------------------------------

interface WordPressComSiteRaw {
  ID: number;
  URL: string;
  name: string;
  description?: string;
  jetpack?: boolean;
}

async function fetchWordPressComJson(path: string, accessToken: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${WPCOM_API_BASE}${path}`, { signal: controller.signal, headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch (err) {
    clearTimeout(timeout);
    throw new WordPressApiError(0, `Could not reach WordPress.com: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timeout);
  const body = await res.text();
  if (res.status === 401) throw new WordPressAuthError("WordPress.com rejected this access token -- reconnect your WordPress.com account.");
  if (res.status === 403) throw new WordPressPermissionError(`WordPress.com denied permission: ${body}`);
  if (!res.ok) throw new WordPressApiError(res.status, `WordPress.com API failed: ${res.status} ${res.statusText} -- ${body}`);
  return body ? JSON.parse(body) : {};
}

export interface WordPressComSite {
  readonly id: string;
  readonly url: string;
  readonly name: string;
}

function normalizeWordPressComSite(raw: WordPressComSiteRaw): WordPressComSite {
  return { id: String(raw.ID), url: raw.URL, name: raw.name };
}

/** Real GET to WordPress.com's own /me/sites -- the site-discovery call that lets ADASOS list what the user manages instead of asking them to type a URL. */
async function fetchWordPressComSites(accessToken: string): Promise<WordPressComSite[]> {
  const data = (await fetchWordPressComJson("/rest/v1.1/me/sites", accessToken)) as { sites?: WordPressComSiteRaw[] };
  return (data.sites ?? []).map(normalizeWordPressComSite);
}

export function buildWordPressComConnectUrl(redirectUri: string, state: string): string {
  return buildWordPressComAuthUrl({ redirectUri, state });
}

export interface WordPressComConnectResult {
  readonly siteSelected: boolean;
  readonly sites: readonly WordPressComSite[];
}

/**
 * Exchanges the OAuth2 code for an access token, then immediately
 * discovers the user's real WordPress.com sites via /me/sites. If there's
 * exactly one, it's auto-selected -- satisfying "automatically discover...
 * instead of requiring the user to manually enter a site URL". If there are
 * several, the connection is still saved (so the token isn't lost) but with
 * no site selected yet; the caller (route) shows a picker using the
 * returned `sites` list. Zero sites is not an error -- the account is
 * connected, just with nothing to select yet.
 */
export async function exchangeWordPressComCodeAndSaveConnection(userId: string, code: string, redirectUri: string): Promise<WordPressComConnectResult> {
  const tokens = await exchangeWordPressComCodeForToken(code, redirectUri);
  const sites = await fetchWordPressComSites(tokens.access_token);

  const selected = sites.length === 1 ? sites[0] : null;
  const data = {
    provider: "wordpress-com",
    siteUrl: selected?.url ?? "",
    siteName: selected?.name ?? null,
    accessToken: tokens.access_token,
    wpcomSiteId: selected?.id ?? null,
    username: null,
    appPassword: null,
  };
  await db.wordPressConnection.upsert({ where: { userId }, update: data, create: { userId, ...data } });

  return { siteSelected: selected !== null, sites };
}

/** Re-lists the connected WordPress.com account's real sites, for the picker UI when more than one exists (or the user wants to switch). */
export async function listWordPressComSites(userId: string): Promise<WordPressComSite[]> {
  const connection = await db.wordPressConnection.findUnique({ where: { userId } });
  if (!connection || connection.provider !== "wordpress-com" || !connection.accessToken) {
    throw new WordPressNotConfiguredError();
  }
  return fetchWordPressComSites(connection.accessToken);
}

/** Selects one of the account's real sites as the active connection -- re-verifies it against a fresh /me/sites call rather than trusting the given id blindly. */
export async function selectWordPressComSite(userId: string, siteId: string): Promise<WordPressComSite> {
  const connection = await db.wordPressConnection.findUnique({ where: { userId } });
  if (!connection || connection.provider !== "wordpress-com" || !connection.accessToken) {
    throw new WordPressNotConfiguredError();
  }
  const sites = await fetchWordPressComSites(connection.accessToken);
  const site = sites.find((s) => s.id === siteId);
  if (!site) {
    throw new WordPressInvalidSiteError("That site is not in this WordPress.com account's real site list.");
  }
  await db.wordPressConnection.update({ where: { userId }, data: { siteUrl: site.url, siteName: site.name, wpcomSiteId: site.id } });
  return site;
}

// ---------------------------------------------------------------------------
// Shared connection status / disconnect / content operations
// ---------------------------------------------------------------------------

export interface WordPressConnectionStatus {
  readonly connected: boolean;
  readonly provider?: "self-hosted" | "wordpress-com";
  readonly siteUrl?: string;
  readonly siteName?: string;
  readonly connectedAt?: string;
  readonly needsSiteSelection?: boolean;
}

/** "Connected" means a connection row exists AND a real, live call against it succeeds right now -- not just that a row is present. */
export async function getConnectionStatus(userId: string): Promise<WordPressConnectionStatus> {
  const connection = await db.wordPressConnection.findUnique({ where: { userId } });
  if (!connection) return { connected: false };

  if (connection.provider === "wordpress-com") {
    if (!connection.accessToken) return { connected: false };
    if (!connection.wpcomSiteId) {
      try {
        await fetchWordPressComJson("/rest/v1.1/me", connection.accessToken);
        return { connected: false, provider: "wordpress-com", needsSiteSelection: true };
      } catch {
        return { connected: false };
      }
    }
    try {
      await fetchWordPressComJson(`/rest/v1.1/sites/${connection.wpcomSiteId}`, connection.accessToken);
      return { connected: true, provider: "wordpress-com", siteUrl: connection.siteUrl, siteName: connection.siteName ?? undefined, connectedAt: connection.updatedAt.toISOString() };
    } catch {
      return { connected: false, provider: "wordpress-com", siteUrl: connection.siteUrl };
    }
  }

  try {
    await verifyCredentials(connection.siteUrl, connection.username!, connection.appPassword!);
    return { connected: true, provider: "self-hosted", siteUrl: connection.siteUrl, siteName: connection.siteName ?? undefined, connectedAt: connection.updatedAt.toISOString() };
  } catch {
    return { connected: false, provider: "self-hosted", siteUrl: connection.siteUrl };
  }
}

/**
 * Removes the stored connection. For self-hosted, best-effort revokes the
 * Application Password on WordPress's own side first (introspect it to
 * find its uuid, then delete it) -- mirrors server/google-oauth.ts's
 * revokeGoogleToken(): a failed remote revoke is non-fatal, the local row
 * is removed regardless. WordPress.com's OAuth2 has no documented public
 * token-revocation endpoint, so for that provider this only removes the
 * local row -- the token remains valid on WordPress.com's side until it
 * expires on its own; this module does not invent a revoke call that
 * doesn't exist.
 */
export async function disconnect(userId: string): Promise<void> {
  const connection = await db.wordPressConnection.findUnique({ where: { userId } });
  if (!connection) return;

  if (connection.provider === "self-hosted" && connection.username && connection.appPassword) {
    try {
      const res = await fetch(`${connection.siteUrl}/wp-json/wp/v2/users/me/application-passwords/introspect`, {
        headers: { Authorization: basicAuthHeader(connection.username, connection.appPassword), Accept: "application/json" },
      });
      if (res.ok) {
        const data: { uuid?: string } = await res.json();
        if (data.uuid) {
          await fetch(`${connection.siteUrl}/wp-json/wp/v2/users/me/application-passwords/${encodeURIComponent(data.uuid)}`, {
            method: "DELETE",
            headers: { Authorization: basicAuthHeader(connection.username, connection.appPassword) },
          });
        }
      }
    } catch {
      // Best-effort -- see doc comment above.
    }
  }

  await db.wordPressConnection.delete({ where: { userId } });
}

async function requireConnection(userId: string) {
  const connection = await db.wordPressConnection.findUnique({ where: { userId } });
  if (!connection) throw new WordPressNotConfiguredError();
  if (connection.provider === "wordpress-com" && !connection.wpcomSiteId) throw new WordPressSiteNotSelectedError();
  return connection;
}

type WordPressConnectionRecord = {
  provider: string;
  siteUrl: string;
  username: string | null;
  appPassword: string | null;
  accessToken: string | null;
  wpcomSiteId: string | null;
};

function requestTarget(connection: WordPressConnectionRecord): { baseUrl: string; authHeader: string } {
  if (connection.provider === "wordpress-com") {
    return { baseUrl: `${WPCOM_API_BASE}/wp/v2/sites/${connection.wpcomSiteId}`, authHeader: `Bearer ${connection.accessToken}` };
  }
  return { baseUrl: `${connection.siteUrl}/wp-json/wp/v2`, authHeader: basicAuthHeader(connection.username!, connection.appPassword!) };
}

/** Real HTTP call to the connected site's wp/v2 REST surface (self-hosted `{siteUrl}/wp-json/wp/v2` via Basic Auth, or WordPress.com's `public-api.wordpress.com/wp/v2/sites/{id}` proxy via Bearer token), with a timeout and retry-with-backoff on 5xx/network failures. Never retries 401/403 -- those are real auth/permission failures, not transient. */
async function wpFetch(connection: WordPressConnectionRecord, path: string, init: RequestInit = {}): Promise<unknown> {
  const { baseUrl, authHeader } = requestTarget(connection);
  const url = `${baseUrl}${path}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: authHeader, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
      });
    } catch (err) {
      clearTimeout(timeout);
      const timedOut = err instanceof Error && err.name === "AbortError";
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw timedOut
        ? new WordPressApiError(0, `WordPress request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms.`)
        : new WordPressApiError(0, `WordPress request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    clearTimeout(timeout);

    if (res.status === 401) throw new WordPressAuthError(`WordPress rejected these credentials (401) for ${path}.`);
    if (res.status === 403) {
      const body = await res.text();
      throw new WordPressPermissionError(`WordPress denied permission (403) for ${path} -- ${body}`);
    }
    const body = await res.text();
    if (!res.ok) {
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new WordPressApiError(res.status, `WordPress API failed: ${res.status} ${res.statusText} -- ${body}`);
    }
    return body ? JSON.parse(body) : {};
  }
  throw new WordPressApiError(0, `WordPress request to ${path} failed after retries.`);
}

export type WordPressContentType = "post" | "page";

export interface NormalizedWordPressPost {
  readonly id: number;
  readonly type: WordPressContentType;
  readonly status: string;
  readonly title: string;
  readonly link: string;
  readonly excerpt: string;
  readonly date: string;
  readonly modified: string;
  readonly featuredMediaId: number;
}

interface RawWordPressPost {
  id: number;
  status: string;
  link: string;
  date: string;
  modified: string;
  title?: { rendered?: string; raw?: string };
  excerpt?: { rendered?: string; raw?: string };
  featured_media?: number;
}

function normalizePost(raw: RawWordPressPost, type: WordPressContentType): NormalizedWordPressPost {
  return {
    id: raw.id,
    type,
    status: raw.status,
    title: raw.title?.rendered ?? raw.title?.raw ?? "",
    link: raw.link,
    excerpt: raw.excerpt?.rendered ?? raw.excerpt?.raw ?? "",
    date: raw.date,
    modified: raw.modified,
    featuredMediaId: raw.featured_media ?? 0,
  };
}

function typePath(type: WordPressContentType): string {
  return type === "page" ? "/pages" : "/posts";
}

export interface WordPressSiteInfo {
  readonly name: string;
  readonly description: string;
  readonly url: string;
}

/** Real, live site info -- self-hosted reads the site's public REST index; WordPress.com reads the site's real /rest/v1.1/sites/{id} record. Never cached/guessed. */
export async function getSiteInfo(userId: string): Promise<WordPressSiteInfo> {
  const connection = await requireConnection(userId);
  if (connection.provider === "wordpress-com") {
    const site = (await fetchWordPressComJson(`/rest/v1.1/sites/${connection.wpcomSiteId}`, connection.accessToken!)) as { name?: string; description?: string; URL?: string };
    return { name: site.name ?? "", description: site.description ?? "", url: site.URL ?? connection.siteUrl };
  }
  const index = await discoverSite(connection.siteUrl);
  return { name: index.name ?? "", description: index.description ?? "", url: index.url ?? connection.siteUrl };
}

export interface ListContentParams {
  status?: string;
  search?: string;
  page?: number;
  perPage?: number;
}

/** Real GET to /wp/v2/posts or /wp/v2/pages with context=edit, so drafts (not just published content) are visible to the connected, authenticated user. */
export async function listContent(userId: string, type: WordPressContentType = "post", params: ListContentParams = {}): Promise<NormalizedWordPressPost[]> {
  const connection = await requireConnection(userId);
  const qs = new URLSearchParams({ context: "edit", page: String(params.page ?? 1), per_page: String(params.perPage ?? 10) });
  if (params.status) qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  const data = (await wpFetch(connection, `${typePath(type)}?${qs.toString()}`)) as RawWordPressPost[];
  return data.map((p) => normalizePost(p, type));
}

/** Real GET for a single post/page's status and permalink, plus title/content metadata. */
export async function getContent(userId: string, id: number, type: WordPressContentType = "post"): Promise<NormalizedWordPressPost> {
  const connection = await requireConnection(userId);
  const data = (await wpFetch(connection, `${typePath(type)}/${id}?context=edit`)) as RawWordPressPost;
  return normalizePost(data, type);
}

export interface CreateDraftInput {
  title: string;
  content: string;
  excerpt?: string;
  type?: WordPressContentType;
}

/** Real POST that creates new content -- status is always forced to "draft" here, regardless of caller input. Publishing is a separate, explicit function (publishPost) so this one can never accidentally go live. */
export async function createDraft(userId: string, input: CreateDraftInput): Promise<NormalizedWordPressPost> {
  const connection = await requireConnection(userId);
  const type = input.type ?? "post";
  const data = (await wpFetch(connection, typePath(type), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, content: input.content, excerpt: input.excerpt ?? "", status: "draft" }),
  })) as RawWordPressPost;
  return normalizePost(data, type);
}

export interface UpdateContentInput {
  title?: string;
  content?: string;
  excerpt?: string;
  featuredMediaId?: number;
}

/** Real POST that updates content fields -- deliberately never touches `status`, so editing a draft can never publish it as a side effect, and this same function is safe to reuse for updating an already-published post's fields (the API route layer is what gates *that* case behind explicit approval, since going live is the state that actually needs it, not routine field edits on a draft). */
export async function updateContent(userId: string, id: number, input: UpdateContentInput, type: WordPressContentType = "post"): Promise<NormalizedWordPressPost> {
  const connection = await requireConnection(userId);
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.title = input.title;
  if (input.content !== undefined) body.content = input.content;
  if (input.excerpt !== undefined) body.excerpt = input.excerpt;
  if (input.featuredMediaId !== undefined) body.featured_media = input.featuredMediaId;
  const data = (await wpFetch(connection, `${typePath(type)}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as RawWordPressPost;
  return normalizePost(data, type);
}

/** Convenience wrapper over updateContent for the one field callers most often need to set on its own. */
export async function setFeaturedImage(userId: string, id: number, mediaId: number, type: WordPressContentType = "post"): Promise<NormalizedWordPressPost> {
  return updateContent(userId, id, { featuredMediaId: mediaId }, type);
}

/**
 * The ONLY function in this module that sets status to "publish". Must only
 * ever be called from the one route that requires an explicit
 * `{ confirm: true }` body (api/integrations/wordpress/content/[id]/publish),
 * exactly mirroring server/gmail.ts's sendDraft() -- never called
 * automatically, never called as a side effect of drafting or editing.
 */
export async function publishPost(userId: string, id: number, type: WordPressContentType = "post"): Promise<NormalizedWordPressPost> {
  const connection = await requireConnection(userId);
  const data = (await wpFetch(connection, `${typePath(type)}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "publish" }),
  })) as RawWordPressPost;
  return normalizePost(data, type);
}

/** Real DELETE. `force` bypasses the trash for a permanent delete -- used for cleaning up temporary/test content, never for real content without the caller explicitly asking for a permanent delete. */
export async function deleteContent(userId: string, id: number, type: WordPressContentType = "post", force = false): Promise<void> {
  const connection = await requireConnection(userId);
  await wpFetch(connection, `${typePath(type)}/${id}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export interface UploadMediaInput {
  filename: string;
  mimeType: string;
  data: Buffer;
  altText?: string;
}

export interface UploadedMedia {
  readonly id: number;
  readonly sourceUrl: string;
}

/** Real POST of raw binary bytes to /wp/v2/media, per the WordPress REST API's documented direct-upload format (Content-Type = the file's mime type, Content-Disposition names the file) -- no multipart form needed. Works identically for both providers, since both expose the same wp/v2 media endpoint shape. */
export async function uploadMedia(userId: string, input: UploadMediaInput): Promise<UploadedMedia> {
  const connection = await requireConnection(userId);
  const data = (await wpFetch(connection, "/media", {
    method: "POST",
    headers: {
      "Content-Type": input.mimeType,
      "Content-Disposition": `attachment; filename="${input.filename.replace(/"/g, "")}"`,
    },
    body: new Uint8Array(input.data),
  })) as { id: number; source_url: string };

  if (input.altText) {
    await wpFetch(connection, `/media/${data.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: input.altText }),
    });
  }

  return { id: data.id, sourceUrl: data.source_url };
}
