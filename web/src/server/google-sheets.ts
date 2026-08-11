// Real Google Sheets integration, following the same shape as
// server/google-business-profile.ts (connect/callback/status/disconnect,
// honest real API calls, never-fabricated data), stored in the generic
// server/db.ts GoogleServiceConnection table (service: "sheets") and built
// on the shared OAuth core in server/google-oauth.ts.
//
// Sheets API alone cannot enumerate a user's spreadsheets -- listing files
// requires Drive API's metadata scope. Both scopes are requested together
// and are read-only, matching this codebase's least-privilege convention
// (server/google-search-console.ts's webmasters.readonly).

import { db } from "@/server/db";
import { buildGoogleAuthUrl, exchangeGoogleCodeForTokens, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokenResponse } from "@/server/google-oauth";

const SERVICE = "sheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

export interface SpreadsheetValues {
  range: string;
  majorDimension: string;
  values: string[][];
}

function redirectUri(): string {
  return `${process.env.NEXTAUTH_URL}/api/integrations/google-sheets/callback`;
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

/** Returns a usable access token for `userId`'s Sheets connection, refreshing it first if it's expired or about to expire. Returns null if there's no connection. */
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

/** Real call to the Drive API's files.list, filtered to spreadsheets only. Throws with the full response body on failure -- callers must not swallow it into a generic message. */
export async function listSpreadsheets(userId: string): Promise<SpreadsheetFile[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name,modifiedTime)",
    pageSize: "25",
    orderBy: "modifiedTime desc",
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Drive files.list failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { files?: SpreadsheetFile[] } = body ? JSON.parse(body) : {};
  return data.files ?? [];
}

/** Real call to the Sheets API's spreadsheets.values.get. Throws with the full response body on failure. */
export async function getSpreadsheetValues(userId: string, spreadsheetId: string, range: string): Promise<SpreadsheetValues> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const res = await fetch(`${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets spreadsheets.values.get failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: Partial<SpreadsheetValues> = body ? JSON.parse(body) : {};
  return { range: data.range ?? range, majorDimension: data.majorDimension ?? "ROWS", values: data.values ?? [] };
}

/** Persists which spreadsheet the user has selected for this integration, mirroring GoogleSearchConsoleConnection.selectedSiteUrl but stored in the shared GoogleServiceConnection.metadataJson field per its own documented convention. */
export async function setSelectedSpreadsheet(userId: string, spreadsheetId: string, name: string): Promise<void> {
  await db.googleServiceConnection.update({
    where: { userId_service: { userId, service: SERVICE } },
    data: { metadataJson: JSON.stringify({ selectedSpreadsheetId: spreadsheetId, selectedSpreadsheetName: name }) },
  });
}

export async function getSelectedSpreadsheet(userId: string): Promise<{ id: string; name: string } | null> {
  const connection = await db.googleServiceConnection.findUnique({
    where: { userId_service: { userId, service: SERVICE } },
    select: { metadataJson: true },
  });
  if (!connection?.metadataJson) return null;
  const parsed: { selectedSpreadsheetId?: string; selectedSpreadsheetName?: string } = JSON.parse(connection.metadataJson);
  if (!parsed.selectedSpreadsheetId) return null;
  return { id: parsed.selectedSpreadsheetId, name: parsed.selectedSpreadsheetName ?? "" };
}
