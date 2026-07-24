import { describe, expect, it } from "vitest";
import {
  GoogleSheetsIntegrationRequestValidator,
  GoogleSheetsIntegrationValidationError,
} from "../../../../src/agents/google-sheets-integration-agent/validation/google-sheets-integration-request-validator.js";
import type { GoogleSheetsIntegrationRequest } from "../../../../src/agents/google-sheets-integration-agent/types/google-sheets-integration-request.types.js";
import type { AiCrmResult } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";
import type { OutreachResult } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { CampaignTrackingResult } from "../../../../src/agents/campaign-tracking-agent/types/campaign-tracking-request.types.js";
import type { ReplyNegotiationResult } from "../../../../src/agents/reply-negotiation-agent/types/reply-negotiation-request.types.js";

function makeCrmData(): AiCrmResult {
  return {
    requestId: "crm-1",
    dataAvailable: true,
    leadPipeline: [],
    followUpActivities: [],
    clientStatusReport: [],
    campaignActivity: { campaignName: "Campaign", phase: "in-progress", draftedCount: 1, skippedCount: 0 },
    crmRecordUpdates: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
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

function makeRequest(overrides: Partial<GoogleSheetsIntegrationRequest> = {}): GoogleSheetsIntegrationRequest {
  return {
    id: "req-1",
    spreadsheetId: "sheet-123",
    crmData: makeCrmData(),
    outreach: makeOutreach(),
    campaignTracking: makeCampaignTracking(),
    replyNegotiation: makeReplyNegotiation(),
    ...overrides,
  };
}

describe("GoogleSheetsIntegrationRequestValidator", () => {
  const validator = new GoogleSheetsIntegrationRequestValidator();

  describe("validate", () => {
    it("accepts a well-formed request", () => {
      expect(() => validator.validate(makeRequest())).not.toThrow();
    });

    it("throws when spreadsheetId is blank", () => {
      expect(() => validator.validate(makeRequest({ spreadsheetId: "   " }))).toThrow(GoogleSheetsIntegrationValidationError);
    });
  });

  describe("findDestructiveActionSignals", () => {
    it("returns an empty array when there are no user instructions", () => {
      expect(validator.findDestructiveActionSignals(makeRequest())).toEqual([]);
    });

    it("returns an empty array for clean user instructions", () => {
      expect(validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Add the new client to the sheet." }))).toEqual([]);
    });

    it("flags an overwrite signal", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Overwrite the pricing column." }));
      expect(signals).toContain("overwrite");
    });

    it("flags a deletion signal", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Delete the old publisher rows." }));
      expect(signals).toContain("deletion");
    });

    it("flags a removal signal", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Remove all rows for this client." }));
      expect(signals).toContain("removal");
    });

    it("flags a purge signal", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Purge the archived rows." }));
      expect(signals).toContain("purge");
    });

    it("flags a wipe signal", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Wipe the outreach tab." }));
      expect(signals).toContain("wipe");
    });

    it("returns each matched label only once even with multiple occurrences", () => {
      const signals = validator.findDestructiveActionSignals(makeRequest({ userInstructions: "Delete this row. Also delete that row." }));
      expect(signals.filter((s) => s === "deletion")).toHaveLength(1);
    });
  });
});
