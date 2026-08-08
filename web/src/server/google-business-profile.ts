// Real Google Business Profile integration, following the same shape as
// server/google-search-console.ts (connect/callback/status/disconnect,
// honest real API calls, never-fabricated data) but stored in the generic
// server/db.ts GoogleServiceConnection table (service: "business_profile")
// rather than a dedicated table, and built on the shared OAuth core in
// server/google-oauth.ts rather than reimplementing token exchange/refresh.
//
// IMPORTANT: Google gates the Business Profile APIs behind a separate,
// manual access-request approval (support.google.com/business/contact/api_default)
// that applies even to a single developer testing with their own account --
// confirmed directly from Google's own documentation
// (developers.google.com/my-business/content/basic-setup). Until that
// approval is granted for this project, every call in this file will fail
// with a real error from Google (the API is not yet enabled for this
// project), not a bug in this code. See the Phase 2 Step 2 verification
// report for details.

import { db } from "@/server/db";
import { buildGoogleAuthUrl, exchangeGoogleCodeForTokens, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokenResponse } from "@/server/google-oauth";

const SERVICE = "business_profile";
const SCOPE = "https://www.googleapis.com/auth/business.manage";
const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";

export interface BusinessProfileAccount {
  name: string; // "accounts/{accountId}"
  accountName: string;
  type: string;
}

function redirectUri(): string {
  return `${process.env.NEXTAUTH_URL}/api/integrations/google-business-profile/callback`;
}

export function buildAuthUrl(state: string): string {
  return buildGoogleAuthUrl({ scope: SCOPE, redirectUri: redirectUri(), state });
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  return exchangeGoogleCodeForTokens(code, redirectUri());
}

export async function saveConnection(userId: string, tokens: GoogleTokenResponse) {
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh_token (expected with prompt=consent).");
  }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  return db.googleServiceConnection.upsert({
    where: { userId_service: { userId, service: SERVICE } },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
    create: { userId, service: SERVICE, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope, expiresAt },
  });
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; connectedAt?: string }> {
  const connection = await db.googleServiceConnection.findUnique({
    where: { userId_service: { userId, service: SERVICE } },
    select: { updatedAt: true },
  });
  return connection ? { connected: true, connectedAt: connection.updatedAt.toISOString() } : { connected: false };
}

export async function disconnect(userId: string): Promise<void> {
  const connection = await db.googleServiceConnection.findUnique({ where: { userId_service: { userId, service: SERVICE } } });
  if (!connection) return;
  await revokeGoogleToken(connection.refreshToken);
  await db.googleServiceConnection.delete({ where: { userId_service: { userId, service: SERVICE } } });
}

/** Returns a usable access token for `userId`'s Business Profile connection, refreshing it first if it's expired or about to expire. Returns null if there's no connection. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await db.googleServiceConnection.findUnique({ where: { userId_service: { userId, service: SERVICE } } });
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return connection.accessToken;
  }

  const refreshed = await refreshGoogleAccessToken(connection.refreshToken);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.googleServiceConnection.update({
    where: { userId_service: { userId, service: SERVICE } },
    data: { accessToken: refreshed.access_token, expiresAt },
  });
  return refreshed.access_token;
}

/** Real call to the Business Profile Account Management API's accounts.list. Throws with the full response body on failure -- callers must not swallow it into a generic message. */
export async function listAccounts(userId: string): Promise<BusinessProfileAccount[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Business Profile connection exists for this user.");
  }

  const res = await fetch(ACCOUNTS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Business Profile accounts.list failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { accounts?: BusinessProfileAccount[] } = body ? JSON.parse(body) : {};
  return data.accounts ?? [];
}
