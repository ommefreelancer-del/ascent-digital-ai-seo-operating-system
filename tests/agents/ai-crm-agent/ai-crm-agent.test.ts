import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiCrmAgent } from "../../../src/agents/ai-crm-agent/ai-crm-agent.js";
import { AiCrmRequestValidator } from "../../../src/agents/ai-crm-agent/validation/ai-crm-request-validator.js";
import { LeadPipelineBuilder } from "../../../src/agents/ai-crm-agent/crm/lead-pipeline-builder.js";
import { FollowUpActivityBuilder } from "../../../src/agents/ai-crm-agent/crm/follow-up-activity-builder.js";
import { ClientStatusReportBuilder } from "../../../src/agents/ai-crm-agent/crm/client-status-report-builder.js";
import { CampaignActivityReportBuilder } from "../../../src/agents/ai-crm-agent/crm/campaign-activity-report-builder.js";
import { CrmRecordUpdateBuilder } from "../../../src/agents/ai-crm-agent/crm/crm-record-update-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { AiCrmRequest } from "../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeOutreach(overrides: Partial<OutreachResult> = {}): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [{ domain: "example.com", sequenceNumber: 1, scheduledDate: "2026-07-08T00:00:00.000Z", messageDraft: "x", requiresApproval: true }],
    outreachStatus: [{ domain: "example.com", status: "drafted", notes: "x" }],
    skippedPublishers: [],
    limitations: ["Outreach limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCampaignTracking(overrides: Partial<CampaignTrackingResult> = {}): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Plumbing Guest Post Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 1, draftedCount: 1, skippedCount: 0 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: ["Campaign tracking limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReplyNegotiation(overrides: Partial<ReplyNegotiationResult> = {}): ReplyNegotiationResult {
  return {
    requestId: "rn-1",
    dataAvailable: true,
    conversationSummaries: [],
    quotedTerms: [],
    negotiationRecommendations: [],
    replyDrafts: [],
    finalAgreedPricing: [],
    negotiationStatusReport: [{ domain: "example.com", status: "negotiating", notes: "x" }],
    limitations: ["Reply negotiation limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AiCrmRequest> = {}): AiCrmRequest {
  return {
    id: "req-1",
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    replyNegotiation: makeReplyNegotiation(),
    ...overrides,
  };
}

describe("AiCrmAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ai-crm-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent() {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new AiCrmAgent(
      new AiCrmRequestValidator(),
      new LeadPipelineBuilder(),
      new FollowUpActivityBuilder(),
      new ClientStatusReportBuilder(),
      new CampaignActivityReportBuilder(),
      new CrmRecordUpdateBuilder(),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a real lead pipeline, follow-up activity, campaign activity, and CRM record proposals", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.manageCrm(
      makeRequest({ clientInfo: [{ clientName: "Acme Plumbing", status: "active retainer", lastContactedAt: "2026-07-01T00:00:00.000Z" }] }),
    );

    expect(result.dataAvailable).toBe(true);
    expect(result.leadPipeline).toEqual([{ domain: "example.com", stage: "negotiating", notes: "x" }]);
    expect(result.followUpActivities).toHaveLength(1);
    expect(result.campaignActivity).toEqual({ campaignName: "Plumbing Guest Post Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 });
    expect(result.clientStatusReport).toHaveLength(1);
    expect(result.crmRecordUpdates).toHaveLength(2);
    expect(await readEventTypes(auditLogPath)).toEqual(["ai_crm_requested", "ai_crm_completed"]);
  });

  it("carries forward every upstream limitation plus its own standing disclaimers", async () => {
    const { agent } = buildAgent();
    const result = await agent.manageCrm(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Outreach limitation.",
        "Campaign tracking limitation.",
        "Reply negotiation limitation.",
        "No client information was supplied; the client status report is empty.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("cannot determine whether a prospect record already exists"))).toBe(true);
  });

  it("reports dataAvailable false and an empty pipeline when there is no real activity at all", async () => {
    const { agent } = buildAgent();

    const result = await agent.manageCrm(
      makeRequest({
        outreach: makeOutreach({ dataAvailable: false, outreachStatus: [], followUpSchedule: [] }),
        replyNegotiation: makeReplyNegotiation({ dataAvailable: false, negotiationStatusReport: [] }),
      }),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.leadPipeline).toEqual([]);
    expect(result.limitations.some((l) => l.includes("No real outreach or negotiation activity was available"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(
      agent.manageCrm(makeRequest({ clientInfo: [{ clientName: "  ", status: "x", lastContactedAt: "2026-07-01" }] })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["ai_crm_validation_failed"]);
  });
});
