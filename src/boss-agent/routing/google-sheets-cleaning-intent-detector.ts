// GOOGLE SHEETS CLEANING ROUTING FIX (2026-09-17, broadened 2026-09-20): a real, live-confirmed production
// defect -- a request to clean "Health Master Sheet" using the configured Google Sheets Write Destination
// was routed to "human_approval_gate" instead of google-sheets-integration-agent, because
// human-approval-gate-intent-detector.ts's own HUMAN_APPROVAL_GATE_PHRASES list includes generic,
// safety-instruction phrasing ("pending approval", "pending approvals") that a genuine Google Sheets
// cleaning proposal naturally uses when describing its own human-approval-gated write step (see
// google-sheets-cleaning.ts's own chat report: "...requires your explicit action", "nothing has been
// written..."). Human approval is a LATER workflow state for the cleaning result, never the specialist
// responsible for producing it -- task-router.ts's human-approval-gate check ran BEFORE any specialist
// routing was even considered, so this generic phrase collision could hijack a clearly Sheets-specific
// request before it ever reached ordinary specialist scoring.
//
// BROADENING (2026-09-20): a SECOND real, live-confirmed defect -- the original phrase lists below were too
// narrow to recognize a genuine "Source: Health Master Sheet, Destination: Admin Sheet Health, protect
// existing destination records" request (real, reproduced offline against the real registry/router: scored
// as low as 0.22-0.39 under ordinary TagWeightedRoutingStrategy scoring, well below the 0.50 auto-assign
// threshold, because the message named real sheet names -- "Admin Sheet Health" -- rather than any of the
// old DOMAIN_PHRASES verbatim, and used words like "protect"/"proposal"/"validate" the old ACTION_PHRASES
// didn't cover at all). Broadened the DOMAIN phrases with "destination"/"source" (the two generic nouns
// EVERY Google Sheets read/write-destination request in this codebase's own vocabulary already uses --
// see google-sheets-cleaning.ts's own "Configured write destination:"/"read source" report language --
// deliberately NOT any specific sheet's own name, since a destination/source sheet can be renamed to
// anything and this module must never hardcode one) and the ACTION phrases with "protect"/"proposal"/
// "validate"/"merge"/"baseline"/"read-only"/"read only" (duplicate-protection, proposal, and read-only-
// validation language a real Sheets-cleaning request naturally uses).
//
// This module detects the narrow, unambiguous case: the message is genuinely ABOUT processing/cleaning a
// Google Sheet (names the Sheets/spreadsheet domain AND a cleaning/processing action) -- not a bare mention
// of "approval" on its own. Mirrors human-approval-gate-intent-detector.ts's own "explicit workflow naming
// is an unambiguous signal on its own" precedent, just for the opposite direction: THIS domain must win
// over that generic gate-phrase collision, never the reverse -- a genuine "check my pending approvals" with
// no Sheets-cleaning signal at all is completely unaffected and keeps routing to "human_approval_gate"
// exactly as before. Requiring BOTH a domain phrase AND an action phrase (never either alone) is what keeps
// this narrow even after broadening -- a bare "process the traffic source" or "validate the image
// destination folder" (no Sheets-cleaning action AND domain signal actually co-occurring the way a real
// Sheets request does) still does not match.

const GOOGLE_SHEETS_CLEANING_DOMAIN_PHRASES: readonly string[] = ["google sheet", "google sheets", "spreadsheet", "health master", "write destination"];

// WHOLE-WORD-ONLY domain phrases (2026-09-20): "source" and "destination" are real, live-confirmed
// substring-collision risks under plain .includes() matching -- a real, existing routing test's message
// ("...confirm tool/resource availability...") contains "resource", which literally CONTAINS "source" as a
// substring ("re" + "source"), so a bare .includes("source") check false-matched an unrelated
// system-verification request. Matched via a real word-boundary regex instead (still case-insensitive, and
// this codebase's OWN vocabulary already uses both as bare nouns -- see google-sheets-cleaning.ts's "read
// source"/"Configured write destination:" report language) so "resource"/"outsource"/"destinations-only
// policy" style substrings can never false-trigger, while a genuine standalone "source"/"destination"
// mention still does.
const GOOGLE_SHEETS_CLEANING_WHOLE_WORD_DOMAIN_PHRASES: readonly RegExp[] = [/\bsource\b/, /\bdestination\b/];

const GOOGLE_SHEETS_CLEANING_ACTION_PHRASES: readonly string[] = [
  "clean",
  "process",
  "prepare",
  "inspect",
  "dedup",
  "duplicate",
  "normali",
  "protect",
  "proposal",
  "validate",
  "merge",
  "baseline",
  "read-only",
  "read only",
];

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

function matchesAnyWholeWord(lower: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(lower));
}

/**
 * True when `taskDescription` explicitly names the Google Sheets/spreadsheet domain (e.g. "Google Sheet",
 * "spreadsheet", "Health Master Sheet", "write destination", or a standalone "source"/"destination" as a
 * whole word) AND a cleaning/processing action (e.g. "clean", "process", "prepare", "inspect", "dedupe",
 * "protect", "proposal", "validate", "merge", "read-only") -- narrow enough that a bare mention of either
 * alone (a generic "approval" question, or an unrelated "clean" request with no Sheets context) does not
 * match. See file header.
 */
export function isGoogleSheetsCleaningIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;
  const hasDomainSignal = includesAny(lower, GOOGLE_SHEETS_CLEANING_DOMAIN_PHRASES) || matchesAnyWholeWord(lower, GOOGLE_SHEETS_CLEANING_WHOLE_WORD_DOMAIN_PHRASES);
  return hasDomainSignal && includesAny(lower, GOOGLE_SHEETS_CLEANING_ACTION_PHRASES);
}
