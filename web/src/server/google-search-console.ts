import { db } from "@/server/db";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** siteUnverifiedUser is the one permissionLevel sites.list returns for a property nobody has verified ownership of yet -- every other value (siteOwner, siteFullUser, siteRestrictedUser) means Search Console has confirmed ownership and will serve real data for it. */
function isVerified(site: SearchConsoleSite): boolean {
  return site.permissionLevel !== "siteUnverifiedUser";
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

function redirectUri(): string {
  return `${process.env.NEXTAUTH_URL}/api/integrations/google-search-console/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // forces a refresh_token on every connect, not just the first
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function saveConnection(userId: string, tokens: TokenResponse) {
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh_token (expected with prompt=consent).");
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  return db.googleSearchConsoleConnection.upsert({
    where: { userId },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
    create: { userId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
  });
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; connectedAt?: string }> {
  const connection = await db.googleSearchConsoleConnection.findUnique({ where: { userId }, select: { updatedAt: true } });
  return connection ? { connected: true, connectedAt: connection.updatedAt.toISOString() } : { connected: false };
}

export async function disconnect(userId: string): Promise<void> {
  const connection = await db.googleSearchConsoleConnection.findUnique({ where: { userId } });
  if (!connection) return;
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(connection.refreshToken)}`, { method: "POST" }).catch(() => {
    // Best-effort revoke -- Google's own token expiry/rotation makes this non-fatal either way.
  });
  await db.googleSearchConsoleConnection.delete({ where: { userId } });
}

/** Returns a usable access token for `userId`'s Search Console connection, refreshing it first if it's expired or about to expire. Returns null if there's no connection. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await db.googleSearchConsoleConnection.findUnique({ where: { userId } });
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const refreshed: { access_token: string; expires_in: number } = await res.json();
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.googleSearchConsoleConnection.update({ where: { userId }, data: { accessToken: refreshed.access_token, expiresAt } });
  return refreshed.access_token;
}

/** Real call to Google's Search Console `sites.list`. Throws with the full response body on failure -- callers must not swallow it into a generic message. */
export async function listSites(userId: string): Promise<SearchConsoleSite[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Search Console connection exists for this user.");
  }

  const res = await fetch(SITES_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Search Console sites.list failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { siteEntry?: SearchConsoleSite[] } = body ? JSON.parse(body) : {};
  return data.siteEntry ?? [];
}

export async function getVerifiedSites(userId: string): Promise<SearchConsoleSite[]> {
  return (await listSites(userId)).filter(isVerified);
}

/**
 * Resolves which property Search Analytics calls should target for this
 * user, and persists the choice so it doesn't get re-derived (and
 * potentially re-ordered) on every call. This never existed before --
 * listSites() can return several properties per account (most Wix-
 * auto-registered and unverified) and nothing chose one.
 *
 * Auto-selection is intentionally simple: the first verified property,
 * re-validated against the live list every time (a site that gets
 * unverified, or a previously-selected site that disappears, must not keep
 * silently "selecting" it). Returns null if there is no connection, or the
 * connection exists but no property is verified yet.
 */
export async function getOrSelectPrimarySite(userId: string): Promise<string | null> {
  const connection = await db.googleSearchConsoleConnection.findUnique({ where: { userId }, select: { selectedSiteUrl: true } });
  if (!connection) return null;

  const verified = await getVerifiedSites(userId);
  if (verified.length === 0) {
    if (connection.selectedSiteUrl !== null) {
      await db.googleSearchConsoleConnection.update({ where: { userId }, data: { selectedSiteUrl: null } });
    }
    return null;
  }

  if (connection.selectedSiteUrl && verified.some((s) => s.siteUrl === connection.selectedSiteUrl)) {
    return connection.selectedSiteUrl;
  }

  const primary = verified[0]!.siteUrl;
  await db.googleSearchConsoleConnection.update({ where: { userId }, data: { selectedSiteUrl: primary } });
  return primary;
}

export async function setSelectedSite(userId: string, siteUrl: string): Promise<void> {
  const verified = await getVerifiedSites(userId);
  if (!verified.some((s) => s.siteUrl === siteUrl)) {
    throw new Error(`"${siteUrl}" is not a verified Search Console property for this account.`);
  }
  await db.googleSearchConsoleConnection.update({ where: { userId }, data: { selectedSiteUrl: siteUrl } });
}

export interface SearchAnalyticsQuery {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}

/** Real call to Google's Search Console `searchAnalytics.query`. Throws with the full response body on failure. Returns [] (not an error) when the query is valid but Search Console simply has no rows for the range -- e.g. a property verified too recently for data to exist yet. */
export async function querySearchAnalytics(userId: string, siteUrl: string, query: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Search Console connection exists for this user.");
  }

  const res = await fetch(`${SITES_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: query.dimensions ?? [],
      rowLimit: query.rowLimit ?? 25,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Search Console searchAnalytics.query failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { rows?: SearchAnalyticsRow[] } = body ? JSON.parse(body) : {};
  return data.rows ?? [];
}
