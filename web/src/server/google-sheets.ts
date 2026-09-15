// Real Google Sheets integration, following the same shape as
// server/google-business-profile.ts (connect/callback/status/disconnect,
// honest real API calls, never-fabricated data), stored in the generic
// server/db.ts GoogleServiceConnection table (service: "sheets") and built
// on the shared OAuth core in server/google-oauth.ts.
//
// Sheets API alone cannot enumerate a user's spreadsheets -- listing files
// requires Drive API's metadata scope, kept at its existing least-privilege
// `drive.metadata.readonly` level (unchanged).
//
// WRITE-SCOPE UPGRADE (2026-09-03): the Sheets scope itself was widened from
// `spreadsheets.readonly` to the full `spreadsheets` scope -- the minimum
// non-readonly scope Google defines for spreadsheets.values.append -- because
// the already-implemented, already-approval-gated write-back
// (spreadsheet-google-sheets-writeback.ts) needs real write access to
// function at all. This is a deliberate, least-privilege choice: no broader
// Drive scope (e.g. drive.file/drive) was added, since listing spreadsheets
// only ever needs metadata, never file contents or management rights.
//
// RE-CONSENT, HONESTLY: an existing connection authorized under the OLD,
// read-only scope has a real access/refresh token pair that Google will
// reject for any write call, regardless of what SCOPE below now requests --
// OAuth scope is fixed at the moment of consent, not retroactively upgraded.
// appendSpreadsheetValues() below NEVER assumes an existing token has the new
// scope: it checks the connection's own persisted `scope` string (set from
// Google's own token response, never invented) before attempting a real
// write, and fails with a clear, actionable "reconnect" message if the write
// scope is missing -- never a raw, confusing 403, and never a silent/false
// success. buildAuthUrl() already passes `prompt=consent` on every connect
// (server/google-oauth.ts), so the very next "Connect Google Sheets" click --
// whether a fresh connection or an explicit reconnect of an existing one --
// shows the user the real, current scope list and issues a token that
// actually has write access.

import { db } from "@/server/db";
import { buildGoogleAuthUrl, exchangeGoogleCodeForTokens, refreshGoogleAccessToken, revokeGoogleToken, type GoogleTokenResponse } from "@/server/google-oauth";
import { encryptSecret, decryptSecret } from "@/server/credential-encryption";

const SERVICE = "sheets";
/** The minimum non-readonly Sheets scope Google defines -- required for spreadsheets.values.append. Exported so a caller (or a test) can check a stored connection's own scope string against this exact value, never a substring guess. */
export const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const SCOPE = `${SHEETS_WRITE_SCOPE} ${DRIVE_METADATA_SCOPE}`;
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_API_URL = "https://sheets.googleapis.com/v4/spreadsheets";

/** Thrown by appendSpreadsheetValues() when the connection's OWN persisted scope (from Google's real token response) does not include the write scope -- never a generic/ambiguous error, and never confused with a real Google API failure. Callers can distinguish it via `instanceof` to render a specific "reconnect" message. */
export class InsufficientGoogleSheetsScopeError extends Error {
  constructor() {
    super(
      "This Google Sheets connection was authorized before write access was added and only has read permission. " +
        "Go to Settings -> Integrations and reconnect Google Sheets to grant write access, then try again.",
    );
    this.name = "InsufficientGoogleSheetsScopeError";
  }
}

/**
 * A1-NOTATION SHEET-NAME QUOTING (2026-09-03): a real, live-confirmed defect -- a real write to the
 * "Admin - Vendor" tab was rejected by Google with a real 400 ("Unable to parse range: Admin - Vendor!A1")
 * because A1 notation requires a sheet name containing a space, a hyphen, or any other character outside
 * `[A-Za-z0-9_]` to be wrapped in single quotes, with any literal single quote inside the name escaped by
 * doubling it (Google Sheets' own A1-notation grammar -- the same convention Excel uses). Always quoting
 * (rather than only when "needed") is simpler, always correct (a quoted plain name like `'Sheet1'!A1` is
 * just as valid as the unquoted form), and reusable for ANY sheet name -- never a special case for just
 * "Admin - Vendor"/"Client Websites".
 */
export function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

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
  const encryptedAccessToken = encryptSecret(tokens.access_token);
  const encryptedRefreshToken = encryptSecret(tokens.refresh_token);
  return db.googleServiceConnection.upsert({
    where: { userId_service: { userId, service: SERVICE } },
    update: { encryptedAccessToken, encryptedRefreshToken, scope: tokens.scope, expiresAt },
    create: { userId, service: SERVICE, encryptedAccessToken, encryptedRefreshToken, scope: tokens.scope, expiresAt },
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
  await revokeGoogleToken(decryptSecret(connection.encryptedRefreshToken));
  await db.googleServiceConnection.delete({ where: { userId_service: { userId, service: SERVICE } } });
}

/** Returns a usable access token for `userId`'s Sheets connection, refreshing it first if it's expired or about to expire. Returns null if there's no connection. */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await db.googleServiceConnection.findUnique({ where: { userId_service: { userId, service: SERVICE } } });
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) {
    return decryptSecret(connection.encryptedAccessToken);
  }

  const refreshed = await refreshGoogleAccessToken(decryptSecret(connection.encryptedRefreshToken));
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db.googleServiceConnection.update({
    where: { userId_service: { userId, service: SERVICE } },
    data: { encryptedAccessToken: encryptSecret(refreshed.access_token), expiresAt },
  });
  return refreshed.access_token;
}

/**
 * SPREADSHEET-DISCOVERY FIX (2026-09-13): two real, confirmed gaps in the original single-page,
 * My-Drive-only query -- (1) `pageSize: 25` with no `nextPageToken` follow-up meant any spreadsheet
 * past the first 25 (by `modifiedTime desc`) was silently invisible everywhere the list is used
 * (Settings selectors, write-destination ownership check, chat context); (2) no `corpora`/
 * `includeItemsFromAllDrives`/`supportsAllDrives` params meant Drive's default `corpora=user` was used,
 * which covers "My Drive" + files individually shared with the user but NOT files living in a Shared
 * Drive the user has access to -- a real Google Sheets file (e.g. one converted from an uploaded Excel
 * file) can legitimately live in either place. Neither fix touches OAuth scope: `drive.metadata.readonly`
 * already covers everything these params expose; this only widens which of the user's OWN
 * already-authorized files the query is allowed to see, not what the token is allowed to do.
 */
export async function listSpreadsheets(userId: string): Promise<SpreadsheetFile[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const files: SpreadsheetFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "nextPageToken,files(id,name,modifiedTime)",
      pageSize: "100",
      orderBy: "modifiedTime desc",
      corpora: "allDrives",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Drive files.list failed: ${res.status} ${res.statusText} -- ${body}`);
    }

    const data: { files?: SpreadsheetFile[]; nextPageToken?: string } = body ? JSON.parse(body) : {};
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
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

/**
 * BATCH READ FIX (2026-09-14): a real, live-confirmed defect -- a single bounded getSpreadsheetValues()
 * call (e.g. "A1:Z1000") silently missed any row past its own upper bound, and separately the caller
 * (google-sheets-integration.ts) truncated its own DISPLAYED rows to 200 -- so a genuinely 1000+-row
 * sheet ("Health Master Sheet"'s Sheet1) was never seen completely by the Google Sheets Integration
 * Agent, with no indication anything was missing. This reads a spreadsheet's first sheet (same bare-range,
 * no-sheet-name-prefix convention getSpreadsheetValues()'s own callers already rely on) in real,
 * successive, row-bounded batches -- calling the SAME already-existing getSpreadsheetValues() repeatedly,
 * never a new/independent read mechanism -- until a batch returns fewer rows than requested (the real,
 * reliable signal from the Sheets API that the true end of data was reached inside that batch) or the
 * absolute safety ceiling (MAX_TOTAL_ROWS) is hit. Never silently stops short of the real end: when the
 * ceiling -- not genuine end of data -- is why reading stopped, `cappedAtSafetyLimit` tells the caller
 * exactly that, so a partial read is never presented as complete.
 */
const BATCH_ROW_SIZE = 500;
/** Absolute ceiling on total rows getAllSpreadsheetValues() will ever accumulate -- bounds the number of real API calls and the size of the returned result for a pathological/very large sheet. Comfortably covers the reported "1000+ rows" case (2-3 batches) with real headroom. */
const MAX_TOTAL_ROWS = 5000;

export interface AllSpreadsheetValuesResult {
  values: string[][];
  rowsRead: number;
  batchesRead: number;
  /** True only when MAX_TOTAL_ROWS (not a genuine short/empty batch) is why reading stopped -- the caller must report this honestly, never silently treat the result as the sheet's complete data. */
  cappedAtSafetyLimit: boolean;
}

export interface GetAllSpreadsheetValuesOptions {
  /** Overrides MAX_TOTAL_ROWS for this call only -- e.g. server-side deterministic processing
   * (google-sheets-cleaning.ts) never embeds raw rows in an LLM prompt, so it can safely use a much
   * higher ceiling than the default (which stays tuned for "safe to embed verbatim in a chat context").
   * Omitted (the default) preserves the EXACT existing 5000-row behavior for every current caller. */
  readonly maxTotalRows?: number;
  /** NAMED-TAB TARGETING (2026-09-21): when omitted (the default), preserves the EXACT existing behavior --
   * a bare, unprefixed range (A1:Z5000 etc.), which the Sheets API resolves to the spreadsheet's FIRST tab
   * only. When provided, every batch range is prefixed with this sheet's own quoted name (via the existing
   * quoteSheetName() helper, already used elsewhere for the same purpose), so a specific tab -- e.g.
   * ADMIN_VENDOR_SHEET_NAME ("Admin - Vendor") or CLIENT_WEBSITES_SHEET_NAME ("Client Sheet") -- can be read
   * directly instead of whichever tab happens to be first. Required for reading ADASOS's own already-written
   * output tabs, which are never the first/only tab in the destination spreadsheet. */
  readonly sheetName?: string;
}

export async function getAllSpreadsheetValues(userId: string, spreadsheetId: string, options?: GetAllSpreadsheetValuesOptions): Promise<AllSpreadsheetValuesResult> {
  const maxTotalRows = options?.maxTotalRows ?? MAX_TOTAL_ROWS;
  const rangePrefix = options?.sheetName ? `${quoteSheetName(options.sheetName)}!` : "";
  const values: string[][] = [];
  let startRow = 1;
  let batchesRead = 0;
  let cappedAtSafetyLimit = false;

  while (true) {
    const endRow = startRow + BATCH_ROW_SIZE - 1;
    const range = `${rangePrefix}A${startRow}:Z${endRow}`;
    const result = await getSpreadsheetValues(userId, spreadsheetId, range);
    batchesRead++;
    values.push(...result.values);

    const reachedRealEndOfData = result.values.length < BATCH_ROW_SIZE;
    if (reachedRealEndOfData) break;

    if (values.length >= maxTotalRows) {
      cappedAtSafetyLimit = true;
      break;
    }
    startRow = endRow + 1;
  }

  return { values, rowsRead: values.length, batchesRead, cappedAtSafetyLimit };
}

/** Real, local (zero-network) check of an already-persisted connection's OWN granted scope string (set from Google's real token response in saveConnection()/getValidAccessToken()'s refresh path) -- never assumes, never guesses. Exported for direct, focused unit testing. */
export function hasSheetsWriteScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes(SHEETS_WRITE_SCOPE);
}

/**
 * The ONE real, zero-network scope gate shared by every write-capable call in this module
 * (appendSpreadsheetValues, ensureSheetExists' create path) AND exported so a caller orchestrating
 * MULTIPLE write calls in one attempt (spreadsheet-google-sheets-writeback.ts) can check ONCE, up front,
 * before touching the network at all -- otherwise a connection with a known-insufficient scope would still
 * make a real (if ultimately pointless) spreadsheets.get read via ensureSheetExists before ever reaching
 * appendSpreadsheetValues' own check. Never blindly attempts a real API call and hopes; fails fast with a
 * clear, actionable InsufficientGoogleSheetsScopeError (never a raw, confusing 403, never a silent/false
 * success) when the write scope is missing.
 */
export async function assertSheetsWriteScope(userId: string): Promise<void> {
  const connection = await db.googleServiceConnection.findUnique({
    where: { userId_service: { userId, service: SERVICE } },
    select: { scope: true },
  });
  if (!connection) {
    throw new Error("No Google Sheets connection exists for this user.");
  }
  if (!hasSheetsWriteScope(connection.scope)) {
    throw new InsufficientGoogleSheetsScopeError();
  }
}

// SPREADSHEET CLEANING WRITE-BACK (2026-09-02, WRITE-SCOPE UPGRADE 2026-09-03): a real Sheets API
// spreadsheets.values.append call, following the exact same real-token/real-fetch/throw-on-failure shape
// as getSpreadsheetValues() above -- NOT a second integration pattern. `SCOPE` above now requests the full
// (non-readonly) `.../auth/spreadsheets` scope, so a NEWLY (re-)authorized connection can genuinely write.
// An EXISTING connection authorized before this change still only carries the old, read-only scope on its
// own token -- Google fixes scope at consent time, never retroactively upgrades it -- so this NEVER
// blindly attempts the real API call and hopes; it checks assertSheetsWriteScope() first.
export async function appendSpreadsheetValues(userId: string, spreadsheetId: string, range: string, values: readonly (readonly string[])[]): Promise<void> {
  await assertSheetsWriteScope(userId);

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const url = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets spreadsheets.values.append failed: ${res.status} ${res.statusText} -- ${body}`);
  }
}

// TAB-EXISTENCE FIX (2026-09-03): a real, live-confirmed production defect -- a correctly-quoted,
// correctly-dimensioned range ('Admin - Vendor'!A1:Q1216) was STILL rejected by Google with a real 400
// "Unable to parse range". This is a well-documented (if confusingly-worded) Google Sheets API behavior:
// the SAME error is returned both for a genuine A1-notation syntax error AND for a range whose sheet name
// does not exist in the target spreadsheet -- spreadsheets.values.append never creates a missing sheet; it
// requires the sheet to already exist. The write-back path (spreadsheet-google-sheets-writeback.ts)
// previously had NO tab-resolution step at all -- it assumed "Admin - Vendor"/"Client Websites" already
// existed in whatever spreadsheet the user configured as the write destination, which is untrue for a
// real, pre-existing user spreadsheet (e.g. "SaaS Website Master Database") that was never specifically
// set up with these tab names. ensureSheetExists() below closes that gap: a real, ownership-scoped,
// read-then-create step (spreadsheets.get to list real existing tab titles, spreadsheets.batchUpdate's
// addSheet request only if genuinely missing) -- never assumes, never invents, and is a real no-op (zero
// extra API calls beyond the one read) when the tab already exists.

/** Real call to the Sheets API's spreadsheets.get, fetching ONLY sheet titles (not cell data) -- the minimum real read needed to know which tabs genuinely already exist. Throws with the full response body on failure. */
async function getSheetTitles(userId: string, spreadsheetId: string): Promise<string[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const url = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("sheets.properties.title")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets spreadsheets.get failed: ${res.status} ${res.statusText} -- ${body}`);
  }

  const data: { sheets?: { properties?: { title?: string } }[] } = body ? JSON.parse(body) : {};
  return (data.sheets ?? []).map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title));
}

/**
 * Ensures a real tab named `sheetName` exists in `spreadsheetId` -- reads the spreadsheet's REAL, current
 * sheet titles first (never assumes), and only calls the real, real batchUpdate addSheet request when the
 * tab is genuinely missing. A real no-op (no write call at all) when it already exists, so calling this
 * before every write attempt (including a retry) is always safe and cheap. Requires the same real write
 * scope as appendSpreadsheetValues() -- checked the same way, with the same InsufficientGoogleSheetsScopeError
 * on an old, read-only-scoped connection.
 */
export async function ensureSheetExists(userId: string, spreadsheetId: string, sheetName: string): Promise<void> {
  const existingTitles = await getSheetTitles(userId, spreadsheetId);
  if (existingTitles.includes(sheetName)) return;

  await assertSheetsWriteScope(userId);

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const url = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets spreadsheets.batchUpdate (addSheet "${sheetName}") failed: ${res.status} ${res.statusText} -- ${body}`);
  }
}

/** The one JSON blob's real shape on GoogleServiceConnection.metadataJson -- READ selection and WRITE destination are two genuinely independent fields on it (see the 2026-09-03 READ/WRITE SEPARATION note below), never conflated. */
interface SheetsConnectionMetadata {
  selectedSpreadsheetId?: string;
  selectedSpreadsheetName?: string;
  writeDestinationSpreadsheetId?: string;
  writeDestinationSpreadsheetName?: string;
}

async function readMetadata(userId: string): Promise<SheetsConnectionMetadata> {
  const connection = await db.googleServiceConnection.findUnique({
    where: { userId_service: { userId, service: SERVICE } },
    select: { metadataJson: true },
  });
  if (!connection?.metadataJson) return {};
  return JSON.parse(connection.metadataJson) as SheetsConnectionMetadata;
}

/** Read-merge-write against the same metadataJson blob -- never clobbers the OTHER half (read selection vs. write destination) that this call isn't touching. */
async function mergeMetadata(userId: string, patch: Partial<SheetsConnectionMetadata>): Promise<void> {
  const current = await readMetadata(userId);
  await db.googleServiceConnection.update({
    where: { userId_service: { userId, service: SERVICE } },
    data: { metadataJson: JSON.stringify({ ...current, ...patch }) },
  });
}

/** Persists which spreadsheet the user has selected to READ FROM (Settings -> Integrations' "Read a spreadsheet" tool), mirroring GoogleSearchConsoleConnection.selectedSiteUrl but stored in the shared GoogleServiceConnection.metadataJson field per its own documented convention. This is DELIBERATELY a separate field from the write destination below -- reading a sheet must never silently change where approved spreadsheet-cleaning results get written. */
export async function setSelectedSpreadsheet(userId: string, spreadsheetId: string, name: string): Promise<void> {
  await mergeMetadata(userId, { selectedSpreadsheetId: spreadsheetId, selectedSpreadsheetName: name });
}

export async function getSelectedSpreadsheet(userId: string): Promise<{ id: string; name: string } | null> {
  const parsed = await readMetadata(userId);
  if (!parsed.selectedSpreadsheetId) return null;
  return { id: parsed.selectedSpreadsheetId, name: parsed.selectedSpreadsheetName ?? "" };
}

// READ/WRITE SEPARATION (2026-09-03): a real, live-confirmed defect -- the approval-gated spreadsheet-
// cleaning write-back (spreadsheet-cleaning-actions.ts / spreadsheet-processing.ts) was calling
// getSelectedSpreadsheet() above, which is ACTUALLY the "Read a spreadsheet" tool's own selection field,
// silently set as a side effect of reading a sheet (see the values API route). There was no dedicated way
// for a user to choose a WRITE destination at all -- the Settings -> Integrations page only ever exposed a
// read-source dropdown. Fixed by adding a genuinely separate field/getter/setter pair, mirroring the read
// pair's own shape exactly, so the write-back path (once callers below are updated to call
// getWriteDestinationSpreadsheet() instead) reads from a destination the user explicitly configured for
// writing, never one that happened to be read from most recently.
export async function setWriteDestinationSpreadsheet(userId: string, spreadsheetId: string, name: string): Promise<void> {
  await mergeMetadata(userId, { writeDestinationSpreadsheetId: spreadsheetId, writeDestinationSpreadsheetName: name });
}

export async function getWriteDestinationSpreadsheet(userId: string): Promise<{ id: string; name: string } | null> {
  const parsed = await readMetadata(userId);
  if (!parsed.writeDestinationSpreadsheetId) return null;
  return { id: parsed.writeDestinationSpreadsheetId, name: parsed.writeDestinationSpreadsheetName ?? "" };
}

// EXISTING-OUTPUT-TAB CLEAR-AND-REPLACE (2026-09-21): every write in this codebase up to this point has
// been append-only (appendSpreadsheetValues() above) -- there has never been a real Sheets API call that
// clears or overwrites existing rows in a live spreadsheet. This is the FIRST one, built specifically and
// NARROWLY for the "de-duplicate an already-written output tab" feature (spreadsheet-existing-output-cleanup.ts):
// reading back a tab ADASOS itself generated (e.g. "Admin - Vendor"), proposing exactly which rows are exact
// duplicates, and -- only after explicit human approval -- replacing that ONE named tab's contents with the
// deduplicated rows. Deliberately a single function that clears a tab and immediately rewrites it in one
// call, rather than exposing a bare/general "clear" primitive on its own, so no caller can ever clear a tab
// and leave it empty on a subsequent failure without also being the same call that writes the replacement
// values right after.
export async function clearAndReplaceSheetValues(userId: string, spreadsheetId: string, sheetName: string, headerRow: readonly string[], dataRows: readonly (readonly string[])[]): Promise<void> {
  await assertSheetsWriteScope(userId);

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google Sheets connection exists for this user.");
  }

  const range = `${quoteSheetName(sheetName)}!A1:Z`;
  const clearUrl = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`;
  const clearRes = await fetch(clearUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const clearBody = await clearRes.text();
  if (!clearRes.ok) {
    throw new Error(`Sheets spreadsheets.values.clear failed: ${clearRes.status} ${clearRes.statusText} -- ${clearBody}`);
  }

  const values = [headerRow, ...dataRows];
  const updateRange = `${quoteSheetName(sheetName)}!A1`;
  const updateUrl = `${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(updateRange)}?valueInputOption=RAW`;
  const updateRes = await fetch(updateUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ range: updateRange, majorDimension: "ROWS", values }),
  });
  const updateBody = await updateRes.text();
  if (!updateRes.ok) {
    throw new Error(`Sheets spreadsheets.values.update failed: ${updateRes.status} ${updateRes.statusText} -- ${updateBody}`);
  }
}
