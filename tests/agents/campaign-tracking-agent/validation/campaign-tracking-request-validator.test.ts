import { describe, expect, it } from "vitest";
import {
  CampaignTrackingRequestValidator,
  CampaignTrackingValidationError,
} from "../../../../src/agents/campaign-tracking-agent/validation/campaign-tracking-request-validator.js";
import type { CampaignTrackingRequest } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";

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

function makeRequest(overrides: Partial<CampaignTrackingRequest> = {}): CampaignTrackingRequest {
  return { id: "req-1", campaignName: "Plumbing Guest Post Campaign", outreach: makeOutreach(), ...overrides };
}

describe("CampaignTrackingRequestValidator", () => {
  const validator = new CampaignTrackingRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignName is empty", () => {
    expect(() => validator.validate(makeRequest({ campaignName: "   " }))).toThrow(CampaignTrackingValidationError);
  });
});
