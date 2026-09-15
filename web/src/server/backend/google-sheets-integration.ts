// Bridges the Google Sheets Integration Agent to the real Google Sheets/
// Drive OAuth connector (server/google-sheets.ts).
//
// PHASE 4 LIVE INTEGRATION FIX (2026-08-18): before this file existed,
// nothing in the AI Workspace chat path ever called that connector --
// api/workspace/messages/route.ts had no GOOGLE_SHEETS_INTEGRATION_AGENT_ID
// dispatch branch at all, so an assigned "google-sheets-integration-agent"
// message fell straight through to the bare LLM role-play branch with no
// real data or status signal appended -- exactly why the live agent
// reported "UNKNOWN / NOT VERIFIABLE FROM HERE": there was truly nothing
// real for it to check. Investigation confirmed the real connector itself
// was never broken -- server/google-sheets.ts is a complete, working
// OAuth2 + Drive/Sheets API integration, same connect/callback/status/
// disconnect shape as the already-working Google Search Console
// integration (server/google-search-console.ts), backed by the shared
// GoogleServiceConnection table, with a live "Connect Google Sheets"
// control already in Settings -> Integrations. This mirrors
// buildSearchConsoleContext()'s own convention exactly (Performance &
// Analytics Agent's identical fix) -- the same pattern, reused, not a
// second competing integration architecture.
//
// REAL, NOT FABRICATED (GLOBAL_RULES.md SS2): every branch below reflects a
// real, just-checked condition -- not connected / connected but the real
// health-check call failed / connected and verified with a real result.
// Never throws -- a failure at any stage becomes a plainly-stated status,
// not a crashed request. NEVER includes an access/refresh token in the
// returned text -- only real, non-secret evidence (file names, ids,
// timestamps, counts), matching getConnectionStatus()'s own "non-secret
// status read" convention (server/github.ts's getConnectionStatus() never
// returns its encrypted token either).
//
// TENANT ISOLATION: every call below is scoped to the requesting `userId` --
// getConnectionStatus/listSpreadsheets/getSelectedSpreadsheet all query
// GoogleServiceConnection by `{ userId, service: "sheets" }`, the same real
// client-isolation boundary every other sensitive model in this schema
// uses. There is no query path here that can return another account's
// connection or spreadsheet list.

import { getConnectionStatus, listSpreadsheets, getSelectedSpreadsheet, getAllSpreadsheetValues, type SpreadsheetFile, type AllSpreadsheetValuesResult } from "@/server/google-sheets";

const MAX_LISTED_SPREADSHEETS = 10;

// AGENT READ-WIRING FIX (2026-09-13): a real, live-confirmed defect -- once a spreadsheet was selected,
// this context still only ever told the agent the spreadsheet's NAME/id, then explicitly instructed it
// that "to read actual values, the user must specify a spreadsheet and a range" (see the removed line
// below). The agent correctly followed that instruction and asked the user to paste/attach Sheet1's row
// data, even though ADASOS already has a live, authenticated Drive/Sheets connection and a persisted
// selection for exactly this spreadsheet -- there was never a real reason to ask.
//
// BATCH READ FIX (2026-09-14): a real, live-confirmed follow-on defect -- a bounded single-call read
// (previously "A1:Z1000") silently missed any row past its own upper bound, and this file separately
// capped its own DISPLAYED rows at 200 regardless -- so a genuinely 1000+-row sheet ("Health Master
// Sheet"'s Sheet1) was never seen completely by the agent, with no indication anything was missing.
// Now uses google-sheets.ts's real getAllSpreadsheetValues() -- real, successive, row-bounded batches
// (calling the SAME already-existing getSpreadsheetValues() repeatedly, never a new/independent read
// path) against the spreadsheet's first sheet (bare range, no sheet-name prefix needed), continuing
// until the real end of data or a real, honestly-reported safety ceiling. Every row that function
// returns is shown here -- no separate, smaller display-only truncation on top of it.
function formatSelectedSpreadsheetRows(name: string, result: AllSpreadsheetValuesResult): string {
  const { values: rows, rowsRead, batchesRead, cappedAtSafetyLimit } = result;

  if (rowsRead === 0) {
    return (
      `A real spreadsheets.values.get call read "${name}" (its first sheet) and found zero rows -- ` +
      "the sheet is genuinely empty. State this honestly; do not invent placeholder rows."
    );
  }

  const lines = rows.map((row, i) => `  Row ${i + 1}: ${row.map((cell) => cell ?? "").join(" | ")}`);
  return [
    `${batchesRead} real spreadsheets.values.get call(s) read "${name}" (its first sheet) in batches and returned ${rowsRead} row(s) total. Real row data (pipe-separated columns, verbatim, ALL rows, never truncated to a smaller display limit):`,
    ...lines,
    cappedAtSafetyLimit
      ? `  [Reading stopped at a real safety limit (${rowsRead} rows) rather than a confirmed end of data -- this sheet may genuinely have more rows beyond what's shown. State this honestly if asked whether this is the complete sheet.]`
      : `  [This is the complete sheet -- reading stopped because a real batch returned fewer rows than requested, confirming the true end of data.]`,
    "Use this real data directly to analyze the spreadsheet. Never invent additional rows, columns, or values beyond what's shown here. This is a READ ONLY result -- any write/update/delete back to this spreadsheet still requires the existing explicit human-approval flow; never claim a write happened from this context alone.",
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeSpreadsheets(
  files: readonly SpreadsheetFile[],
  connectedAt: string,
  selected: { id: string; name: string } | null,
  selectedRowsBlock: string | null,
): string {
  const lines = files.slice(0, MAX_LISTED_SPREADSHEETS).map((f) => `  - "${f.name}" (id: ${f.id}${f.modifiedTime ? `, last modified ${f.modifiedTime}` : ""})`);
  return [
    `[Google Sheets integration status: CONNECTED and verified (connected since ${connectedAt}). A real Drive files.list call found ${files.length} accessible spreadsheet(s):`,
    ...lines,
    files.length > MAX_LISTED_SPREADSHEETS ? `  ...and ${files.length - MAX_LISTED_SPREADSHEETS} more.` : "",
    selected ? `Currently selected spreadsheet for this integration: "${selected.name}" (id: ${selected.id}).` : "No spreadsheet is currently selected for this integration.",
    selectedRowsBlock,
    selected
      ? "Use the real data above directly -- never ask the user to paste or attach it, and never invent spreadsheets, ids, or cell contents beyond what's shown.]"
      : "Use this real list directly. Never invent additional spreadsheets, ids, or cell contents beyond what's listed here -- to read actual values, the user must first select a spreadsheet in Settings -> Integrations.]",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds a real, non-fabricated context block describing this user's actual
 * Google Sheets connection state -- meant to be appended to the message
 * passed to generateSpecialistReply, exactly like buildSearchConsoleContext()
 * does for Performance & Analytics Agent, so the Google Sheets Integration
 * Agent's chat replies are grounded in the real, live connector instead of
 * reporting "UNKNOWN / NOT VERIFIABLE." Never throws.
 */
export async function buildGoogleSheetsContext(userId: string): Promise<string> {
  const status = await getConnectionStatus(userId);
  if (!status.connected) {
    return "[Google Sheets integration status: NOT CONNECTED. Tell the user to go to Settings -> Integrations -> Connect Google Sheets before any spreadsheet can be read or synced, and offer best-practice guidance in the meantime. Do not claim a connection exists or invent spreadsheet data.]";
  }

  let spreadsheets: SpreadsheetFile[];
  try {
    spreadsheets = await listSpreadsheets(userId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return (
      `[Google Sheets integration status: CONNECTED (since ${status.connectedAt}), but the real health-check call ` +
      `(Drive files.list) failed: ${reason}. State this plainly to the user -- do not guess at spreadsheet contents ` +
      "or claim the integration is working.]"
    );
  }

  const selected = await getSelectedSpreadsheet(userId);

  if (spreadsheets.length === 0) {
    return (
      `[Google Sheets integration status: CONNECTED and verified (connected since ${status.connectedAt}). A real ` +
      "Drive files.list call found zero spreadsheets accessible to this account. State this honestly -- do not " +
      "fabricate spreadsheet names or data.]"
    );
  }

  let selectedRowsBlock: string | null = null;
  if (selected) {
    try {
      const result = await getAllSpreadsheetValues(userId, selected.id);
      selectedRowsBlock = formatSelectedSpreadsheetRows(selected.name, result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "an unknown error";
      selectedRowsBlock =
        `A real spreadsheets.values.get call to read "${selected.name}" failed: ${reason}. State this plainly to the user -- ` +
        "do not guess at row contents or claim the read succeeded.";
    }
  }

  return summarizeSpreadsheets(spreadsheets, status.connectedAt!, selected, selectedRowsBlock);
}
