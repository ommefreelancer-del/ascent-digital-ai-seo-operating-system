import { describe, expect, it } from "vitest";
import { CrmRecordUpdateBuilder } from "../../../../src/agents/ai-crm-agent/crm/crm-record-update-builder.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { ReplyNegotiationResult } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { ClientInfoEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

function makeOutreach(outreachStatus: OutreachResult["outreachStatus"]): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus,
    skippedPublishers: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeReplyNegotiation(negotiationStatusReport: ReplyNegotiationResult["negotiationStatusReport"] = []): ReplyNegotiationResult {
  return {
    requestId: "rn-1",
    dataAvailable: true,
    conversationSummaries: [],
    quotedTerms: [],
    negotiationRecommendations: [],
    replyDrafts: [],
    finalAgreedPricing: [],
    negotiationStatusReport,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeClient(overrides: Partial<ClientInfoEntry> = {}): ClientInfoEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("CrmRecordUpdateBuilder", () => {
  const builder = new CrmRecordUpdateBuilder();

  it("returns no updates when there is no real outreach or client activity", () => {
    expect(builder.build(makeOutreach([]), makeReplyNegotiation(), [])).toEqual([]);
  });

  it("always proposes a prospect record as create, never update, since no CRM read exists", () => {
    const [update] = builder.build(makeOutreach([{ domain: "example.com", status: "drafted", notes: "x" }]), makeReplyNegotiation(), []);
    expect(update).toMatchObject({ recordType: "prospect", action: "create", identifier: "example.com", requiresApproval: true });
  });

  it("includes the real negotiation pipeline stage in the prospect summary when known", () => {
    const [update] = builder.build(
      makeOutreach([{ domain: "example.com", status: "drafted", notes: "x" }]),
      makeReplyNegotiation([{ domain: "example.com", status: "negotiating", notes: "x" }]),
      [],
    );
    expect(update?.summary).toContain("negotiating");
  });

  it("proposes a real client record as update", () => {
    const [update] = builder.build(makeOutreach([]), makeReplyNegotiation(), [makeClient()]);
    expect(update).toMatchObject({ recordType: "client", action: "update", identifier: "Acme Plumbing", requiresApproval: true });
  });

  it("proposes both prospect and client updates when both are present", () => {
    const updates = builder.build(
      makeOutreach([{ domain: "example.com", status: "drafted", notes: "x" }]),
      makeReplyNegotiation(),
      [makeClient()],
    );
    expect(updates).toHaveLength(2);
  });
});
