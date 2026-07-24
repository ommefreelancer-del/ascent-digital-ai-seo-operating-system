import { describe, expect, it } from "vitest";
import {
  GuestPostingDigitalPrRequestValidator,
  GuestPostingDigitalPrValidationError,
} from "../../../../src/agents/guest-posting-digital-pr-agent/validation/guest-posting-digital-pr-request-validator.js";
import type { GuestPostingDigitalPrRequest } from "../../../../src/agents/guest-posting-digital-pr-agent/types/guest-posting-digital-pr-request.types.js";
import type { ProspectingResult } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";
import type { PublisherQualificationResult } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeProspecting(): ProspectingResult {
  return { requestId: "p-1", dataAvailable: true, prospects: [], duplicatesRemoved: 0, limitations: [], decidedAt: new Date().toISOString() };
}

function makePublisherQualification(): PublisherQualificationResult {
  return { requestId: "pq-1", dataAvailable: true, approvedProspects: [], rejectedProspects: [], limitations: [], decidedAt: new Date().toISOString() };
}

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

describe("GuestPostingDigitalPrRequestValidator", () => {
  const validator = new GuestPostingDigitalPrRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignName is blank", () => {
    expect(() => validator.validate(makeRequest({ campaignName: "   " }))).toThrow(GuestPostingDigitalPrValidationError);
  });
});
