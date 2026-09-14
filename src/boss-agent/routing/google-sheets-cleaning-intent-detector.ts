// GOOGLE SHEETS CLEANING ROUTING FIX (2026-09-17): a real, live-confirmed production defect -- a request
// to clean "Health Master Sheet" using the configured Google Sheets Write Destination was routed to
// "human_approval_gate" instead of google-sheets-integration-agent, because
// human-approval-gate-intent-detector.ts's own HUMAN_APPROVAL_GATE_PHRASES list includes generic,
// safety-instruction phrasing ("pending approval", "pending approvals") that a genuine Google Sheets
// cleaning proposal naturally uses when describing its own human-approval-gated write step (see
// google-sheets-cleaning.ts's own chat report: "...requires your explicit action", "nothing has been
// written..."). Human approval is a LATER workflow state for the cleaning result, never the specialist
// responsible for producing it -- task-router.ts's human-approval-gate check ran BEFORE any specialist
// routing was even considered, so this generic phrase collision could hijack a clearly Sheets-specific
// request before it ever reached ordinary specialist scoring.
//
// This module detects the narrow, unambiguous case: the message is genuinely ABOUT processing/cleaning a
// Google Sheet (names the Sheets/spreadsheet domain AND a cleaning/processing action) -- not a bare mention
// of "approval" on its own. Mirrors human-approval-gate-intent-detector.ts's own "explicit workflow naming
// is an unambiguous signal on its own" precedent, just for the opposite direction: THIS domain must win
// over that generic gate-phrase collision, never the reverse -- a genuine "check my pending approvals" with
// no Sheets-cleaning signal at all is completely unaffected and keeps routing to "human_approval_gate"
// exactly as before.

const GOOGLE_SHEETS_CLEANING_DOMAIN_PHRASES: readonly string[] = ["google sheet", "google sheets", "spreadsheet", "health master", "write destination"];

const GOOGLE_SHEETS_CLEANING_ACTION_PHRASES: readonly string[] = ["clean", "process", "prepare", "inspect", "dedup", "duplicate", "normali"];

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

/**
 * True when `taskDescription` explicitly names the Google Sheets/spreadsheet domain (e.g. "Google Sheet",
 * "spreadsheet", "Health Master Sheet", "write destination") AND a cleaning/processing action (e.g.
 * "clean", "process", "prepare", "inspect", "dedupe") -- narrow enough that a bare mention of either alone
 * (a generic "approval" question, or an unrelated "clean" request with no Sheets context) does not match.
 * See file header.
 */
export function isGoogleSheetsCleaningIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;
  return includesAny(lower, GOOGLE_SHEETS_CLEANING_DOMAIN_PHRASES) && includesAny(lower, GOOGLE_SHEETS_CLEANING_ACTION_PHRASES);
}
