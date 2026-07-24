import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReplyNegotiationAgent } from "../../../src/agents/reply-negotiation-agent/reply-negotiation-agent.js";
import { ReplyNegotiationRequestValidator } from "../../../src/agents/reply-negotiation-agent/validation/reply-negotiation-request-validator.js";
import { NullPublisherReplyProvider } from "../../../src/agents/reply-negotiation-agent/providers/null-publisher-reply-provider.js";
import { ConversationSummaryBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/conversation-summary-builder.js";
import { QuotedTermsBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/quoted-terms-builder.js";
import { NegotiationRecommendationBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-recommendation-builder.js";
import { NegotiationReplyDraftBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-reply-draft-builder.js";
import { NegotiationStatusBuilder } from "../../../src/agents/reply-negotiation-agent/negotiation/negotiation-status-builder.js";
import { AuditLogger } from "../../../src/core/governance/audit-logger.js";
import type { ApprovalChannel } from "../../../src/core/governance/approval-channel.js";
import type { ApprovalDecision } from "../../../src/core/types/approval.types.js";
import type { ReplyNegotiationRequest } from "../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type {
  PublisherReplyProvider,
  PublisherReplyRequest,
  PublisherReplySnapshot,
} from "../../../src/agents/reply-negotiation-agent/types/publisher-reply-provider.types.js";
import type { OutreachResult, OutreachDraft } from "../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

function makeApprovalChannel(decision: ApprovalDecision): ApprovalChannel {
  return { requestDecision: async () => decision };
}

const REJECTING_DECISION: ApprovalDecision = {
  requestId: "unused",
  outcome: "rejected",
  notes: "should not be called",
  decidedAt: new Date().toISOString(),
};

class MapBackedPublisherReplyProvider implements PublisherReplyProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snapshots: ReadonlyMap<string, PublisherReplySnapshot | null>) {}
  async fetchReplies(request: PublisherReplyRequest): Promise<PublisherReplySnapshot | null> {
    return this.snapshots.get(request.domain) ?? null;
  }
}

function makeOutreachDraft(overrides: Partial<OutreachDraft> = {}): OutreachDraft {
  return {
    domain: "example.com",
    url: "https://example.com/blog",
    title: "Example Blog",
    contactMethod: "email",
    contactValue: "hello@example.com",
    subject: "x",
    body: "x",
    requiresApproval: true,
    ...overrides,
  };
}

function makeOutreach(outreachDrafts: OutreachDraft[] = [makeOutreachDraft()]): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts,
    followUpSchedule: [],
    outreachStatus: outreachDrafts.map((d) => ({ domain: d.domain, status: "drafted", notes: "x" })),
    skippedPublishers: [],
    limitations: ["Outreach limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeCampaignTracking(phase: "not-started" | "in-progress" = "in-progress"): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Campaign",
    dataAvailable: true,
    campaignStatus: { phase, totalApprovedPublishers: phase === "in-progress" ? 1 : 0, draftedCount: phase === "in-progress" ? 1 : 0, skippedCount: 0 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: ["Campaign tracking limitation."],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<ReplyNegotiationRequest> = {}): ReplyNegotiationRequest {
  return {
    id: "req-1",
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    targetPricing: { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" },
    ...overrides,
  };
}

describe("ReplyNegotiationAgent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reply-negotiation-agent-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function buildAgent(provider: PublisherReplyProvider, approvalDecision: ApprovalDecision = REJECTING_DECISION) {
    const auditLogPath = join(dir, "audit-log.jsonl");
    const agent = new ReplyNegotiationAgent(
      new ReplyNegotiationRequestValidator(),
      provider,
      new ConversationSummaryBuilder(),
      new QuotedTermsBuilder(),
      new NegotiationRecommendationBuilder(),
      new NegotiationReplyDraftBuilder(),
      new NegotiationStatusBuilder(),
      makeApprovalChannel(approvalDecision),
      new AuditLogger(auditLogPath),
    );
    return { agent, auditLogPath };
  }

  async function readEventTypes(auditLogPath: string): Promise<string[]> {
    const lines = (await readFile(auditLogPath, "utf8")).trim().split("\n");
    return lines.map((line) => JSON.parse(line).eventType);
  }

  it("reports data unavailable and awaiting-reply status with the default NullPublisherReplyProvider", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPublisherReplyProvider());

    const result = await agent.manageNegotiations(makeRequest());

    expect(result.dataAvailable).toBe(false);
    expect(result.conversationSummaries).toEqual([
      { domain: "example.com", replyCount: 0, latestReplyAt: null, summary: "No real reply has been received yet." },
    ]);
    expect(result.negotiationStatusReport).toEqual([{ domain: "example.com", status: "awaiting-reply", notes: expect.any(String) }]);
    expect(result.finalAgreedPricing).toHaveLength(0);
    expect(result.limitations.some((l) => l.includes('using "none-configured"'))).toBe(true);
    expect(await readEventTypes(auditLogPath)).toEqual(["reply_negotiation_requested", "reply_negotiation_completed"]);
  });

  it("carries forward upstream limitations and notes a not-started campaign", async () => {
    const { agent } = buildAgent(new NullPublisherReplyProvider());
    const result = await agent.manageNegotiations(makeRequest({ campaignTracking: makeCampaignTracking("not-started") }));

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Outreach limitation.",
        "Campaign tracking limitation.",
        "The campaign has not started outreach yet, per Campaign Tracking; no replies are expected.",
      ]),
    );
  });

  it("confirms a real within-target quote as final agreed pricing when a human approves", async () => {
    const provider = new MapBackedPublisherReplyProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            replies: [{ replyId: "r1", domain: "example.com", receivedAt: new Date().toISOString(), messageText: "We can do $90 for this." }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const approvingDecision: ApprovalDecision = {
      requestId: "unused",
      outcome: "candidate_selected",
      selectedCandidateId: "confirm",
      notes: "Confirmed.",
      decidedAt: new Date().toISOString(),
    };
    const { agent, auditLogPath } = buildAgent(provider, approvingDecision);

    const result = await agent.manageNegotiations(makeRequest());

    expect(result.dataAvailable).toBe(true);
    expect(result.negotiationRecommendations[0]?.assessment).toBe("within-target");
    expect(result.finalAgreedPricing).toEqual([{ domain: "example.com", agreedPrice: 90, currency: "$", confirmedAt: expect.any(String) }]);
    expect(result.negotiationStatusReport[0]?.status).toBe("agreed-confirmed");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "reply_negotiation_requested",
      "reply_negotiation_escalated",
      "reply_negotiation_escalation_resolved",
      "reply_negotiation_completed",
    ]);
  });

  it("does not fail the request when a human declines to confirm a within-target price -- it just stays pending", async () => {
    const provider = new MapBackedPublisherReplyProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            replies: [{ replyId: "r1", domain: "example.com", receivedAt: new Date().toISOString(), messageText: "We can do $90 for this." }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider, REJECTING_DECISION);

    const result = await agent.manageNegotiations(makeRequest());

    expect(result.finalAgreedPricing).toHaveLength(0);
    expect(result.negotiationStatusReport[0]?.status).toBe("agreed-pending-confirmation");
    expect(await readEventTypes(auditLogPath)).toEqual([
      "reply_negotiation_requested",
      "reply_negotiation_escalated",
      "reply_negotiation_escalation_resolved",
      "reply_negotiation_completed",
    ]);
  });

  it("does not escalate at all when no real quote meets the target price", async () => {
    const provider = new MapBackedPublisherReplyProvider(
      new Map([
        [
          "example.com",
          {
            domain: "example.com",
            replies: [{ replyId: "r1", domain: "example.com", receivedAt: new Date().toISOString(), messageText: "We can do $500 for this." }],
            source: "fixed-test-provider",
            retrievedAt: new Date().toISOString(),
          },
        ],
      ]),
    );
    const { agent, auditLogPath } = buildAgent(provider, REJECTING_DECISION);

    const result = await agent.manageNegotiations(makeRequest());

    expect(result.negotiationRecommendations[0]?.assessment).toBe("above-max-reject");
    expect(await readEventTypes(auditLogPath)).toEqual(["reply_negotiation_requested", "reply_negotiation_completed"]);
  });

  it("throws and audit-logs validation failures without producing a result", async () => {
    const { agent, auditLogPath } = buildAgent(new NullPublisherReplyProvider());

    await expect(
      agent.manageNegotiations(makeRequest({ targetPricing: { targetPrice: 0, maxAcceptablePrice: 150, currency: "$" } })),
    ).rejects.toThrow();

    expect(await readEventTypes(auditLogPath)).toEqual(["reply_negotiation_validation_failed"]);
  });
});
