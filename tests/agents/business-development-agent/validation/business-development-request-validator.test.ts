import { describe, expect, it } from "vitest";
import {
  BusinessDevelopmentRequestValidator,
  BusinessDevelopmentValidationError,
} from "../../../../src/agents/business-development-agent/validation/business-development-request-validator.js";
import type {
  BusinessDevelopmentRequest,
  ServicePortfolioItem,
} from "../../../../src/agents/business-development-agent/types/business-development-request.types.js";
import type { AiCrmResult } from "../../../../src/agents/ai-crm-agent/types/ai-crm-request.types.js";

function makeCrmData(overrides: Partial<AiCrmResult> = {}): AiCrmResult {
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
    ...overrides,
  };
}

function makeService(overrides: Partial<ServicePortfolioItem> = {}): ServicePortfolioItem {
  return { serviceName: "SEO Audit", description: "A full technical audit.", priceRangeLabel: "$500-$1,000", ...overrides };
}

function makeRequest(overrides: Partial<BusinessDevelopmentRequest> = {}): BusinessDevelopmentRequest {
  return {
    id: "req-1",
    crmData: makeCrmData(),
    businessGoals: "Grow monthly recurring revenue from existing clients.",
    servicePortfolio: [makeService()],
    ...overrides,
  };
}

describe("BusinessDevelopmentRequestValidator", () => {
  const validator = new BusinessDevelopmentRequestValidator();

  describe("validate", () => {
    it("accepts a well-formed request", () => {
      expect(() => validator.validate(makeRequest())).not.toThrow();
    });

    it("accepts an empty service portfolio", () => {
      expect(() => validator.validate(makeRequest({ servicePortfolio: [] }))).not.toThrow();
    });

    it("throws when businessGoals is blank", () => {
      expect(() => validator.validate(makeRequest({ businessGoals: "   " }))).toThrow(BusinessDevelopmentValidationError);
    });

    it("throws when a servicePortfolio item has a blank serviceName", () => {
      expect(() => validator.validate(makeRequest({ servicePortfolio: [makeService({ serviceName: "  " })] }))).toThrow(
        BusinessDevelopmentValidationError,
      );
    });

    it("throws when a servicePortfolio item has a blank priceRangeLabel", () => {
      expect(() =>
        validator.validate(makeRequest({ servicePortfolio: [makeService({ priceRangeLabel: "  " })] })),
      ).toThrow(BusinessDevelopmentValidationError);
    });
  });

  describe("findPolicyRiskSignals", () => {
    it("returns an empty array for clean text", () => {
      expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
    });

    it("flags guaranteed-results language in businessGoals", () => {
      const signals = validator.findPolicyRiskSignals(makeRequest({ businessGoals: "We guarantee more leads." }));
      expect(signals).toContain("guaranteed results");
    });

    it("flags absolute success claims in marketResearch", () => {
      const signals = validator.findPolicyRiskSignals(
        makeRequest({ marketResearch: "This plan delivers 100% success for every client." }),
      );
      expect(signals).toContain("absolute success claims");
    });

    it("flags guaranteed ranking claims in service portfolio text", () => {
      const signals = validator.findPolicyRiskSignals(
        makeRequest({ servicePortfolio: [makeService({ description: "We get you a #1 ranking on Google." })] }),
      );
      expect(signals).toContain("guaranteed ranking claims");
    });

    it("flags risk-free claims", () => {
      const signals = validator.findPolicyRiskSignals(makeRequest({ businessGoals: "A completely risk-free offer." }));
      expect(signals).toContain("risk-free claims");
    });

    it("returns each matched label only once even with multiple occurrences", () => {
      const signals = validator.findPolicyRiskSignals(
        makeRequest({ businessGoals: "We guarantee results. We guarantee it." }),
      );
      expect(signals.filter((s) => s === "guaranteed results")).toHaveLength(1);
    });
  });
});
