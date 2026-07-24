import { describe, expect, it } from "vitest";
import {
  ReplyNegotiationRequestValidator,
  ReplyNegotiationValidationError,
} from "../../../../src/agents/reply-negotiation-agent/validation/reply-negotiation-request-validator.js";
import type { ReplyNegotiationRequest } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";

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

function makeRequest(overrides: Partial<ReplyNegotiationRequest> = {}): ReplyNegotiationRequest {
  return {
    id: "req-1",
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    targetPricing: { targetPrice: 100, maxAcceptablePrice: 150, currency: "$" },
    ...overrides,
  };
}

describe("ReplyNegotiationRequestValidator", () => {
  const validator = new ReplyNegotiationRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when currency is empty", () => {
    expect(() =>
      validator.validate(makeRequest({ targetPricing: { targetPrice: 100, maxAcceptablePrice: 150, currency: "  " } })),
    ).toThrow(ReplyNegotiationValidationError);
  });

  it("throws when targetPrice is not positive", () => {
    expect(() =>
      validator.validate(makeRequest({ targetPricing: { targetPrice: 0, maxAcceptablePrice: 150, currency: "$" } })),
    ).toThrow(ReplyNegotiationValidationError);
  });

  it("throws when maxAcceptablePrice is below targetPrice", () => {
    expect(() =>
      validator.validate(makeRequest({ targetPricing: { targetPrice: 200, maxAcceptablePrice: 150, currency: "$" } })),
    ).toThrow(ReplyNegotiationValidationError);
  });

  it("accepts targetPrice equal to maxAcceptablePrice", () => {
    expect(() =>
      validator.validate(makeRequest({ targetPricing: { targetPrice: 150, maxAcceptablePrice: 150, currency: "$" } })),
    ).not.toThrow();
  });
});
