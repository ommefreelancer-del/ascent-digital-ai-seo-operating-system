import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CampaignTrackingAgent } from "../../../src/agents/campaign-tracking-agent/campaign-tracking-agent.js";
import { CampaignTrackingRequestValidator } from "../../../src/agents/campaign-tracking-agent/validation/campaign-tracking-request-validator.js";
import { CampaignStatusBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/campaign-status-builder.js";
import { ProgressReportBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/progress-report-builder.js";
import { PerformanceSummaryBuilder } from "../../../src/agents/campaign-tracking-agent/tracking/performance-summary-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { CampaignTrackingRequest } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { OutreachResult, OutreachStatusEntry } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";

function makeOutreach(outreachStatus: OutreachStatusEntry[] = [], dataAvailable = true): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus,
    skippedPublishers: [],
    limitations: ["Outreach limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<CampaignTrackingRequest> = {}): CampaignTrackingRequest {
  return {
    id: "req-1",
    campaignName: "Plumbing Guest Post Campaign",
    outreach: makeOutreach([{ domain: "a.com", status: "drafted", notes: "x" }]),
    ...overrides,
  };
}

describe("CampaignTrackingAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "campaign-tracking-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent() {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new CampaignTrackingAgent(
      new CampaignTrackingRequestValidator(),
      new CampaignStatusBuilder(),
      new ProgressReportBuilder(),
      new PerformanceSummaryBuilder(),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a real campaign status, progress reports, and performance summary", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.trackCampaign(
      makeRequest({ campaignUpdates: [{ date: "2026-07-01", description: "Kickoff." }] }),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.campaignStatus).toEqual({ phase: "in-progress", totalApprovedPublishers: 1, draftedCount: 1, skippedCount: 0 });
    expect(result.progressReports).toEqual([{ date: "2026-07-01", description: "Kickoff." }]);
    expect(result.performanceSummary).toEqual({ draftRate: 1, outreachDataAvailable: true });
    expect(await readEventTypes(auditLogPath)).toEqual(["campaign_tracking_requested", "campaign_tracking_completed"]);
  });

  it("carries forward the outreach limitation and notes missing campaign updates", async () => {
    const { agent } = buildAgent();
    const result = await agent.trackCampaign(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Outreach limitation.",
        "No campaign updates were supplied; progress reporting reflects outreach status only.",
      ]),
    );
  });

  it("reports not-started and data unavailable when outreach had nothing at all", async () => {
    const { agent } = buildAgent();
    const result = await agent.trackCampaign(makeRequest({ outreach: makeOutreach([], false) }));

    expect(result.dataAvailable).toBe(false);
    expect(result.campaignStatus.phase).toBe("not-started");
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(agent.trackCampaign(makeRequest({ campaignName: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["campaign_tracking_validation_failed"]);
  });
});
