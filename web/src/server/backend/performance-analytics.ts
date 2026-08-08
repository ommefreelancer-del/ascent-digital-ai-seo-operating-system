// Bridges the Performance & Analytics Agent to the real Google Search
// Console integration (server/google-search-console.ts). Before this
// existed, nothing in the AI Workspace chat path ever called that service --
// api/workspace/messages/route.ts special-cases Website Audit Agent and the
// content pipeline, but fell through to a bare LLM role-play for every other
// agent, including this one, so the assigned specialist had no way to know
// the integration existed at all. This never fabricates: every branch below
// reflects a real, just-checked condition (not connected / connected but
// unverified / connected+verified but no data yet / real data), and the
// text returned is meant to be appended to the user's message before it
// reaches generateSpecialistReply, never to replace the specialist's own
// reasoning about what the data means.

import { getConnectionStatus, getOrSelectPrimarySite, querySearchAnalytics, type SearchAnalyticsRow } from "@/server/google-search-console";

function last28Days(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function summarizeRows(rows: readonly SearchAnalyticsRow[], siteUrl: string, startDate: string, endDate: string): string {
  const totals = rows.reduce((acc, r) => ({ clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions }), { clicks: 0, impressions: 0 });
  const avgCtr = rows.reduce((sum, r) => sum + r.ctr, 0) / rows.length;
  const avgPosition = rows.reduce((sum, r) => sum + r.position, 0) / rows.length;

  const topQueries = rows
    .slice()
    .sort((a, b) => b.clicks - a.clicks)
    .map((r) => `  - "${r.keys[0]}": ${r.clicks} clicks, ${r.impressions} impressions, CTR ${(r.ctr * 100).toFixed(1)}%, avg position ${r.position.toFixed(1)}`)
    .join("\n");

  return [
    `[Google Search Console integration status: CONNECTED and verified for ${siteUrl}. Real searchAnalytics.query data for ${startDate} to ${endDate} (top ${rows.length} queries by clicks):`,
    `Totals across these queries -- clicks: ${totals.clicks}, impressions: ${totals.impressions}, avg CTR: ${(avgCtr * 100).toFixed(1)}%, avg position: ${avgPosition.toFixed(1)}.`,
    "Top queries:",
    topQueries,
    "Use these real numbers directly in your answer. Never invent additional metrics, queries, or trends beyond what's listed here.]",
  ].join("\n");
}

/**
 * Builds a real, non-fabricated context block describing this user's actual
 * Google Search Console state -- meant to be appended to the message passed
 * to generateSpecialistReply so the Performance & Analytics Agent always
 * answers from truth: either real numbers, or a real statement of exactly
 * why real numbers aren't available yet. Never throws -- a failure at any
 * stage becomes a plainly-stated status, not a crashed request.
 */
export async function buildSearchConsoleContext(userId: string): Promise<string> {
  const status = await getConnectionStatus(userId);
  if (!status.connected) {
    return "[Google Search Console integration status: NOT CONNECTED. Tell the user to go to Settings -> Integrations -> Connect Google Search Console before real performance data can be retrieved, and offer best-practice guidance in the meantime.]";
  }

  let primarySite: string | null;
  try {
    primarySite = await getOrSelectPrimarySite(userId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `[Google Search Console integration status: CONNECTED, but the real call to list properties failed: ${reason}. State this plainly to the user -- do not guess at data.]`;
  }

  if (!primarySite) {
    return "[Google Search Console integration status: CONNECTED, but none of the account's properties are verified in Search Console yet, so no performance data can be retrieved. Tell the user to verify a property in Google Search Console, then ask again.]";
  }

  const { startDate, endDate } = last28Days();
  let rows: SearchAnalyticsRow[];
  try {
    rows = await querySearchAnalytics(userId, primarySite, { startDate, endDate, dimensions: ["query"], rowLimit: 10 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `[Google Search Console integration status: CONNECTED and verified for ${primarySite}, but the real searchAnalytics.query call failed: ${reason}. State this plainly to the user -- do not guess at data.]`;
  }

  if (rows.length === 0) {
    return `[Google Search Console integration status: CONNECTED and verified for ${primarySite}. A real searchAnalytics.query for ${startDate} to ${endDate} returned zero rows -- Search Console has no recorded performance data for this property in this range yet (common in the days right after verification). State this honestly; do not fabricate numbers.]`;
  }

  return summarizeRows(rows, primarySite, startDate, endDate);
}
