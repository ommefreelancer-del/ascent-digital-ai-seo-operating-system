import { describe, expect, it } from "vitest";
import {
  AiCrmRequestValidator,
  AiCrmValidationError,
} from "../../../../src/agents/ai-crm-agent/validation/ai-crm-request-validator.js";
import type { AiCrmRequest, ClientInfoEntry } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeOutreach(): OutreachResult {
  return {
    requestId: "out-1",
    dataAvailable: true,
    outreachDrafts: [],
    followUpSchedule: [],
    outreachStatus: [],
    skippedPublishers: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeCampaignTracking(): CampaignTrackingResult {
  return {
    requestId: "ct-1",
    campaignName: "Campaign",
    dataAvailable: true,
    campaignStatus: { phase: "in-progress", totalApprovedPublishers: 1, draftedCount: 1, skippedCount: 0 },
    progressReports: [],
    performanceSummary: { draftRate: 1, outreachDataAvailable: true },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeReplyNegotiation(): ReplyNegotiationResult {
  return {
    requestId: "rn-1",
    dataAvailable: true,
    conversationSummaries: [],
    quotedTerms: [],
    negotiationRecommendations: [],
    replyDrafts: [],
    finalAgreedPricing: [],
    negotiationStatusReport: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeClient(overrides: Partial<ClientInfoEntry> = {}): ClientInfoEntry {
  return { clientName: "Acme Plumbing", status: "active retainer", lastContactedAt: "2026-07-01T00:00:00.000Z", ...overrides };
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

describe("AiCrmRequestValidator", () => {
  const validator = new AiCrmRequestValidator();

  it("accepts a well-formed request with no client info", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("accepts a well-formed request with real client info", () => {
    expect(() => validator.validate(makeRequest({ clientInfo: [makeClient()] }))).not.toThrow();
  });

  it("throws when a clientInfo entry has a blank clientName", () => {
    expect(() => validator.validate(makeRequest({ clientInfo: [makeClient({ clientName: "  " })] }))).toThrow(
      AiCrmValidationError,
    );
  });

  it("throws when a clientInfo entry has a blank status", () => {
    expect(() => validator.validate(makeRequest({ clientInfo: [makeClient({ status: "  " })] }))).toThrow(
      AiCrmValidationError,
    );
  });

  it("throws when a clientInfo entry has a blank lastContactedAt", () => {
    expect(() => validator.validate(makeRequest({ clientInfo: [makeClient({ lastContactedAt: "  " })] }))).toThrow(
      AiCrmValidationError,
    );
  });
});
