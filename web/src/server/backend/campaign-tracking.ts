// Web-layer glue for the real Campaign Tracking Agent
// (src/agents/campaign-tracking-agent/*.ts, compiled to
// dist/src/agents/campaign-tracking-agent). Mirrors remediation.ts's/
// content.ts's own dynamic-import-from-dist pattern -- this app never
// statically imports the frozen backend's TypeScript source.
//
// PHASE 3 PERSISTENCE FIX (2026-08-18): before this file existed,
// CampaignTrackingAgent.trackCampaign() was reachable only from the
// frozen backend's own tests -- nothing in the web app ever called it, and
// even if something had, its real CampaignTrackingResult would have been
// thrown away at the end of the request (in-memory only, nothing survived
// between chat turns or page loads). This closes that gap with a real,
// tenant-scoped Prisma-backed CampaignRecord row (see schema.prisma's own
// header on that model): create -> save -> read/reload -> verify, using
// the SAME real agent class (never reimplemented here) and the SAME
// userId-scoped isolation convention every other model in this schema
// uses (see e.g. admin-governance.ts's own header on that convention).
//
// REAL, NOT FABRICATED (GLOBAL_RULES.md SS2): this bridge never invents an
// OutreachResult. When the caller has a real one (from a completed real
// Outreach Agent run) it is passed through unchanged; today, no web-layer
// Outreach Agent orchestration exists yet (confirmed: no OutreachResult
// producer anywhere under web/src), so an honest, explicitly
// `dataAvailable: false` placeholder with zero drafts/skips is used
// instead of guessing one -- the real agent's own CampaignStatusBuilder is
// what turns that into a "not-started" phase, not this bridge. This is the
// same disclosed-limitation discipline as website-audit.ts's honest
// BLOCKED outcomes and admin-governance.ts's "no fabricated finding"
// convention.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/server/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  return import(/* webpackIgnore: true */ `file://${path.join(backendDist, relativeToSrc)}`);
}

export interface CampaignUpdateEntryView {
  readonly date: string;
  readonly description: string;
}

/** "completed" is deliberately absent -- mirrors the real agent's own CampaignPhase; this build has no real data source to justify that determination. */
export type CampaignPhaseView = "not-started" | "in-progress";

export interface CampaignStatusSummaryView {
  readonly phase: CampaignPhaseView;
  readonly totalApprovedPublishers: number;
  readonly draftedCount: number;
  readonly skippedCount: number;
}

export interface ProgressReportEntryView {
  readonly date: string;
  readonly description: string;
}

export interface PerformanceSummaryView {
  readonly draftRate: number;
  readonly outreachDataAvailable: boolean;
}

export interface CampaignTrackingResultView {
  readonly requestId: string;
  readonly campaignName: string;
  readonly dataAvailable: boolean;
  readonly campaignStatus: CampaignStatusSummaryView;
  readonly progressReports: readonly ProgressReportEntryView[];
  readonly performanceSummary: PerformanceSummaryView;
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

/** Minimal, real shape the frozen agent's own OutreachResult requires -- see src/agents/outreach-agent/types/outreach-request.types.ts. Structural, not imported cross-package (dist has no .d.ts); kept in sync by this file's own tests calling the real compiled agent. */
export interface OutreachResultInput {
  readonly requestId: string;
  readonly dataAvailable: boolean;
  readonly outreachDrafts: readonly unknown[];
  readonly followUpSchedule: readonly unknown[];
  readonly outreachStatus: readonly unknown[];
  readonly skippedPublishers: readonly unknown[];
  readonly limitations: readonly string[];
  readonly decidedAt: string;
}

/** An honest "no real outreach data yet" placeholder -- never a fabricated draft/skip count. */
function emptyOutreachResult(requestId: string): OutreachResultInput {
  return {
    requestId,
    dataAvailable: false,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus: [],
    skippedPublishers: [],
    limitations: ["No real Outreach Agent result was supplied for this campaign -- this build has no web-layer Outreach Agent orchestration yet."],
    decidedAt: new Date().toISOString(),
  };
}

interface CampaignTrackingModules {
  readonly CampaignTrackingAgent: {
    create(config: { auditLogPath: string }): Promise<{
      trackCampaign(request: unknown): Promise<CampaignTrackingResultView>;
    }>;
  };
}

let modulesPromise: Promise<CampaignTrackingModules> | null = null;

async function getModules(): Promise<CampaignTrackingModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const { CampaignTrackingAgent } = await importBackend("agents/campaign-tracking-agent/campaign-tracking-agent.js");
      return { CampaignTrackingAgent };
    })();
  }
  return modulesPromise;
}

export interface TrackCampaignInput {
  readonly campaignName: string;
  readonly campaignUpdates?: readonly CampaignUpdateEntryView[];
  /** A real, already-computed OutreachResult, if one exists. Omit rather than fabricate one. */
  readonly outreach?: OutreachResultInput;
}

/**
 * Runs the REAL CampaignTrackingAgent.trackCampaign() (frozen backend,
 * never reimplemented here) and persists the result as this workspace's own
 * CampaignRecord row -- create on first tracking of a given campaignName,
 * update (never a duplicate) on every subsequent call for the SAME
 * (workspaceId, campaignName) pair, matching refreshExpiredApproval()'s own
 * "reuse the same case" discipline. This is the "create -> save" half of
 * the required create/save/read/verify pipeline.
 */
export async function trackAndSaveCampaign(workspaceId: string, input: TrackCampaignInput): Promise<CampaignTrackingResultView> {
  const { CampaignTrackingAgent } = await getModules();
  const agent = await CampaignTrackingAgent.create({
    auditLogPath: path.join(backendRoot, "var", "web", "campaign-tracking-agent", "audit-log.jsonl"),
  });

  const requestId = randomUUID();
  const result = await agent.trackCampaign({
    id: requestId,
    campaignName: input.campaignName,
    outreach: input.outreach ?? emptyOutreachResult(requestId),
    campaignUpdates: input.campaignUpdates ?? [],
  });

  await db.campaignRecord.upsert({
    where: { userId_campaignName: { userId: workspaceId, campaignName: input.campaignName } },
    create: {
      userId: workspaceId,
      campaignName: input.campaignName,
      requestId: result.requestId,
      dataAvailable: result.dataAvailable,
      phase: result.campaignStatus.phase,
      totalApprovedPublishers: result.campaignStatus.totalApprovedPublishers,
      draftedCount: result.campaignStatus.draftedCount,
      skippedCount: result.campaignStatus.skippedCount,
      resultJson: JSON.stringify(result),
      decidedAt: new Date(result.decidedAt),
    },
    update: {
      requestId: result.requestId,
      dataAvailable: result.dataAvailable,
      phase: result.campaignStatus.phase,
      totalApprovedPublishers: result.campaignStatus.totalApprovedPublishers,
      draftedCount: result.campaignStatus.draftedCount,
      skippedCount: result.campaignStatus.skippedCount,
      resultJson: JSON.stringify(result),
      decidedAt: new Date(result.decidedAt),
    },
  });

  return result;
}

export interface CampaignRecordView {
  readonly id: string;
  readonly campaignName: string;
  readonly result: CampaignTrackingResultView;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toCampaignRecordView(row: { id: string; campaignName: string; resultJson: string; createdAt: Date; updatedAt: Date }): CampaignRecordView {
  return {
    id: row.id,
    campaignName: row.campaignName,
    result: JSON.parse(row.resultJson) as CampaignTrackingResultView,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Real, workspace-scoped read for one campaign, by name -- the "read/reload" half of the pipeline. Never returns another account's row. */
export async function getCampaignRecord(workspaceId: string, campaignName: string): Promise<CampaignRecordView | null> {
  const row = await db.campaignRecord.findUnique({ where: { userId_campaignName: { userId: workspaceId, campaignName } } });
  return row ? toCampaignRecordView(row) : null;
}

/** Every real campaign record this workspace owns, most-recently-updated first. */
export async function listCampaignRecords(workspaceId: string): Promise<readonly CampaignRecordView[]> {
  const rows = await db.campaignRecord.findMany({ where: { userId: workspaceId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toCampaignRecordView);
}

/**
 * Builds a real, non-fabricated context block describing this account's
 * actual, persisted campaign records -- meant to be appended to the message
 * passed to generateSpecialistReply, exactly like buildGovernanceEvidenceContext()
 * does for Admin Agent and buildSearchConsoleContext() does for Performance
 * & Analytics Agent -- so the Campaign Tracking Agent's chat replies are
 * grounded in real, persisted state instead of inventing a status. Never
 * throws.
 */
export async function buildCampaignTrackingContext(workspaceId: string): Promise<string> {
  try {
    const records = await listCampaignRecords(workspaceId);
    if (records.length === 0) {
      return "[CAMPAIGN TRACKING EVIDENCE: no campaign records have been created for this account yet. Do not invent a campaign status, progress update, or performance figure -- ask the user to identify the campaign, or state plainly that none exists yet.]";
    }
    const lines = records.map(
      (r) =>
        `  - "${r.campaignName}": phase=${r.result.campaignStatus.phase}, drafted=${r.result.campaignStatus.draftedCount}, skipped=${r.result.campaignStatus.skippedCount}, dataAvailable=${r.result.dataAvailable}, progress reports=${r.result.progressReports.length}, last updated ${r.updatedAt}.`,
    );
    return [
      "[CAMPAIGN TRACKING EVIDENCE (real, persisted, scoped to this account only):",
      ...lines,
      "Use these real figures directly. Do not invent additional campaigns, statuses, progress updates, or performance data beyond what's listed here.]",
    ].join("\n");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "an unknown error";
    return `[CAMPAIGN TRACKING EVIDENCE: the real evidence query failed: ${reason}. State this plainly to the user -- do not guess at campaign status.]`;
  }
}

// -- Real chat dispatch (PHASE 3 LIVE INTEGRATION FIX, 2026-08-18) ------
//
// Closes the gap the previous persistence-only fix left open: the real
// CampaignRecord persistence layer above existed and its own tests passed,
// but nothing in the live chat dispatch chain
// (web/src/app/api/workspace/messages/route.ts) ever called
// trackAndSaveCampaign() -- an assigned "campaign-tracking-agent" message
// only ever got the read-only grounding-context text appended before
// falling through to the generic, tool-less Claude role-play branch (the
// exact "capability-registry vs. real execution" gap
// capability-classifier.ts's own header documents for every non-dispatch-
// wired agent). runCampaignTrackingFromMessage() is the real, chat-
// dispatch-wired execution path -- mirrors runProspecting()'s own
// extractNiche()-then-run pattern in ./prospecting.ts exactly: a small,
// disclosed regex heuristic pulls a real campaign name out of the actual
// chat text (never fabricated -- returns null, not a guess, when none is
// found), then the SAME real trackAndSaveCampaign() used by the
// /api/campaigns route and by admin-governance-style grounding runs the
// full create -> save -> read -> verify pipeline against real persisted
// state.

/**
 * Small, disclosed heuristic -- extracts a real campaign name from freeform
 * chat text (mirrors extractNiche() in ./prospecting.ts). Tried in order:
 * an explicitly quoted phrase, "campaign called/named X", "campaign: X",
 * then "the X campaign". Never invents a name: returns null (not a guess)
 * when no real signal is present, so the caller can fall back to a
 * read-only, grounded answer instead of creating a spuriously-named record.
 */
const QUOTED_CAMPAIGN_NAME = /["“]([^"”]{2,80})["”]/;
const CAMPAIGN_CALLED_OR_NAMED = /campaign\s+(?:called|named)\s+["']?([A-Z][\w/&-]*(?:\s+[A-Z][\w/&-]*){0,6})["']?/;
const CAMPAIGN_COLON = /campaign\s*:\s*["']?([A-Z][\w/&-]*(?:\s+[A-Z][\w/&-]*){0,6})["']?/;
const THE_X_CAMPAIGN = /\bthe\s+([A-Z][\w/&-]*(?:\s+[A-Z][\w/&-]*){0,4})\s+campaign\b/;
const CAMPAIGN_NAME_PATTERNS: readonly RegExp[] = [QUOTED_CAMPAIGN_NAME, CAMPAIGN_CALLED_OR_NAMED, CAMPAIGN_COLON, THE_X_CAMPAIGN];

export function extractCampaignName(message: string): string | null {
  for (const pattern of CAMPAIGN_NAME_PATTERNS) {
    const candidate = message.match(pattern)?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

export interface CampaignTrackingDispatchResult {
  readonly campaignName: string;
  readonly record: CampaignRecordView;
}

/**
 * Real dispatch: extracts a real campaign name from the chat message, runs
 * the real agent via trackAndSaveCampaign() (create/save), then
 * independently reads the row back via getCampaignRecord() (read) and
 * throws if it genuinely didn't persist (verify) -- never trusts the
 * in-memory return value alone as proof of persistence. Returns null (not
 * a fabricated record) when the message names no real campaign, so the
 * caller can fall back to a grounded, read-only answer instead.
 */
export async function runCampaignTrackingFromMessage(workspaceId: string, message: string): Promise<CampaignTrackingDispatchResult | null> {
  const campaignName = extractCampaignName(message);
  if (!campaignName) return null;

  await trackAndSaveCampaign(workspaceId, { campaignName });

  const record = await getCampaignRecord(workspaceId, campaignName);
  if (!record) {
    throw new Error(`Campaign record for "${campaignName}" was saved but could not be read back -- persistence did not verify.`);
  }

  return { campaignName, record };
}
