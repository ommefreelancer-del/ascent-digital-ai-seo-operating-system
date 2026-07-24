import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuestPostingDigitalPrAgent } from "../../../src/agents/guest-posting-digital-pr-agent/guest-posting-digital-pr-agent.js";
import { GuestPostingDigitalPrRequestValidator } from "../../../src/agents/guest-posting-digital-pr-agent/validation/guest-posting-digital-pr-request-validator.js";
import { PublisherRecordBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/publisher-record-builder.js";
import { CampaignPlanSummaryBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-plan-summary-builder.js";
import { ConfirmedPlacementBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/confirmed-placement-builder.js";
import { CampaignPerformanceReportBuilder } from "../../../src/agents/guest-posting-digital-pr-agent/synthesis/campaign-performance-report-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { GuestPostingDigitalPrRequest } from "../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";
import type { ProspectingResult } from "../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type { PublisherQualificationResult } from "../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachResult } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeProspecting(overrides: Partial<ProspectingResult> = {}): ProspectingResult {
  return {
    requestId: "p-1",
    dataAvailable: true,
    prospects: [{ url: "https://example.com/blog", domain: "example.com", title: "Example Blog", category: "guest-post", confidence: "high", notes: "Real note." }],
    duplicatesRemoved: 2,
    limitations: ["Prospecting limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePublisherQualification(overrides: Partial<PublisherQualificationResult> = {}): PublisherQualificationResult {
  return {
    requestId: "pq-1",
    dataAvailable: true,
    approvedProspects: [{ url: "https://example.com/blog", domain: "example.com", title: "Example Blog", decision: "approved", notes: "Real note." }],
    rejectedProspects: [],
    limitations: ["Publisher qualification limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOutreach(overrides: Partial<OutreachResult> = {}): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus: [{ domain: "example.com", status: "drafted", notes: "Real note." }],
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
    finalAgreedPricing: [{ domain: "example.com", agreedPrice: 150, currency: "USD", confirmedAt: "2026-07-05T00:00:00.000Z" }],
    negotiationStatusReport: [{ domain: "example.com", status: "agreed-confirmed", notes: "Real note." }],
    limitations: ["Reply negotiation limitation."],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<GuestPostingDigitalPrRequest> = {}): GuestPostingDigitalPrRequest {
  return {
    id: "req-1",
    campaignName: "Plumbing Guest Post Campaign",
    prospecting: makeProspecting(),
    publisherQualification: makePublisherQualification(),
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    replyNegotiation: makeReplyNegotiation(),
    ...overrides,
  };
}

describe("GuestPostingDigitalPrAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "guest-posting-digital-pr-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent() {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new GuestPostingDigitalPrAgent(
      new GuestPostingDigitalPrRequestValidator(),
      new PublisherRecordBuilder(),
      new CampaignPlanSummaryBuilder(),
      new ConfirmedPlacementBuilder(),
      new CampaignPerformanceReportBuilder(),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("produces a real consolidated publisher view, plan summary, confirmed placements, and performance report", async () => {
    const { agent, auditLogPath } = buildAgent();

    const result = await agent.manageGuestPostingDigitalPr(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.publisherRecords).toEqual([
      {
        domain: "example.com",
        title: "Example Blog",
        category: "guest-post",
        qualification: "approved",
        outreachStatus: "drafted",
        negotiationStatus: "agreed-confirmed",
        notes: "Real note.",
      },
    ]);
    expect(result.campaignPlanSummary).toEqual({
      totalProspects: 1,
      approvedCount: 1,
      rejectedCount: 0,
      outreachDraftedCount: 1,
      activeNegotiationCount: 0,
    });
    expect(result.confirmedPlacements).toHaveLength(1);
    expect(result.campaignPerformanceReport.confirmedPlacementCount).toBe(1);
    expect(result.campaignPerformanceReport.duplicatesRemoved).toBe(2);
    expect(await readEventTypes(auditLogPath)).toEqual(["guest_posting_digital_pr_requested", "guest_posting_digital_pr_completed"]);
  });

  it("carries forward every upstream limitation plus its own standing disclaimer", async () => {
    const { agent } = buildAgent();
    const result = await agent.manageGuestPostingDigitalPr(makeRequest());

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Prospecting limitation.",
        "Publisher qualification limitation.",
        "Outreach limitation.",
        "Campaign tracking limitation.",
        "Reply negotiation limitation.",
      ]),
    );
    expect(result.limitations.some((l) => l.includes("never claims a live backlink was crawled") || l.includes("live crawl"))).toBe(true);
  });

  it("reports dataAvailable false and an empty publisher list when there is no real activity at all", async () => {
    const { agent } = buildAgent();

    const result = await agent.manageGuestPostingDigitalPr(
      makeRequest({
        prospecting: makeProspecting({ dataAvailable: false, prospects: [], duplicatesRemoved: 0 }),
        publisherQualification: makePublisherQualification({ dataAvailable: false, approvedProspects: [], rejectedProspects: [] }),
        outreach: makeOutreach({ dataAvailable: false, outreachStatus: [] }),
        replyNegotiation: makeReplyNegotiation({ dataAvailable: false, finalAgreedPricing: [], negotiationStatusReport: [] }),
      }),
    );

    expect(result.dataAvailable).toBe(false);
    expect(result.publisherRecords).toEqual([]);
    expect(result.limitations.some((l) => l.includes("No real prospecting, qualification, outreach, or negotiation activity"))).toBe(true);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent();

    await expect(agent.manageGuestPostingDigitalPr(makeRequest({ campaignName: "   " }))).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["guest_posting_digital_pr_validation_failed"]);
  });
});
