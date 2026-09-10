// CAMPAIGN TRACKING ROUTING FIX (2026-08-18): a real, live production
// failure -- reported as "the deployed chat path cannot create and persist
// a campaign even though the Campaign Tracking tests pass." Investigation
// (see web/src/server/backend/campaign-tracking.ts's own real create ->
// save -> read -> verify pipeline, LIVE-VERIFIED working end-to-end via a
// direct database query after a real chat POST) found the backend/database/
// build layer was never broken -- routing was. A clearly-stated request to
// track/update a SPECIFIC, NAMED campaign (e.g. "Please update the campaign
// called Autumn Link Building with progress notes.") scored only ~0.44
// under TagWeightedRoutingStrategy, below the 0.50 auto-assign threshold,
// and was rejected outright -- the campaign's own free-text name (arbitrary
// words like "Autumn", "Link", "Building") dilutes the keyword/tag overlap
// ratio even though every genuinely on-topic word ("campaign", "update",
// "progress") matched cleanly. routing-matrix.integration.test.ts's own
// existing "campaign-tracking-agent" row ("Record the campaign status and
// generate a progress summary...") already proves GENERIC phrasing routes
// fine today -- this gap is specific to messages that name one particular
// campaign, exactly the shape the real create/save dispatch
// (runCampaignTrackingFromMessage() in campaign-tracking.ts) needs to do
// real work. Mirrors prospecting-intent-detector.ts's own deterministic-
// gate pattern exactly; wired into task-router.ts the same way.
//
// NEVER a bare "campaign" keyword: "campaign" is real, shared vocabulary
// across Outreach Agent ("Record campaign progress"), Guest Posting &
// Digital PR Agent ("campaign planning summaries", "campaign completion
// reports"), and Prospecting Agent ("guest posting campaign requirements")
// -- a bare match would misroute their genuine tasks here (verified against
// every "campaign"-containing row already in routing-matrix.integration.test.ts
// and prospecting-intent-detector.test.ts -- none of them trigger this gate).
// Requires ALL of:
//   1. the literal word "campaign" is present, AND
//   2. a real tracking/status-check signal term is present (track, update,
//      monitor, check on, report on, status, progress), AND
//   3. the message names one SPECIFIC campaign -- a quoted phrase,
//      "campaign called/named X", "campaign: X", or "the X campaign" with a
//      real capitalized name (never a bare "this"/"our"/"the" campaign,
//      which stays ordinary/generic scoring's job, already proven to work).
// Condition 3 is what pins this to Campaign Tracking Agent's own domain --
// reporting status/progress FOR ONE particular, named campaign -- rather
// than drafting outreach, consolidating placements across many campaigns,
// or discovering new prospects, none of which typically name one specific
// campaign this way.

const TRACKING_SIGNAL_TERMS: readonly string[] = ["track", "tracking", "update", "updated", "updating", "monitor", "monitoring", "check on", "checking on", "report on", "status", "progress"];

const QUOTED_NAME_SIGNAL = /["“][^"”]{2,80}["”]/;
const CALLED_OR_NAMED_SIGNAL = /campaign\s+(?:called|named)\s+[A-Za-z0-9]/i;
const COLON_SIGNAL = /campaign\s*:\s*[A-Za-z0-9]/i;
const THE_X_CAMPAIGN_SIGNAL = /\bthe\s+[A-Z][\w/&-]*(?:\s+[A-Z][\w/&-]*){0,4}\s+campaign\b/;
const NAMED_CAMPAIGN_SIGNAL_PATTERNS: readonly RegExp[] = [QUOTED_NAME_SIGNAL, CALLED_OR_NAMED_SIGNAL, COLON_SIGNAL, THE_X_CAMPAIGN_SIGNAL];

function includesAny(lower: string, terms: readonly string[]): boolean {
  return terms.some((term) => lower.includes(term));
}

function hasNamedCampaignSignal(taskDescription: string): boolean {
  return NAMED_CAMPAIGN_SIGNAL_PATTERNS.some((pattern) => pattern.test(taskDescription));
}

/**
 * True when `taskDescription` clearly asks to track/update/check the
 * status of one SPECIFIC, NAMED campaign -- Campaign Tracking Agent's own
 * real domain -- narrow enough not to fire on generic "campaign" mentions
 * belonging to Outreach, Guest Posting & Digital PR, or Prospecting. See
 * file header for the real production gap this closes.
 */
export function isCampaignTrackingIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;
  if (!lower.includes("campaign")) return false;
  if (!includesAny(lower, TRACKING_SIGNAL_TERMS)) return false;
  return hasNamedCampaignSignal(taskDescription);
}
