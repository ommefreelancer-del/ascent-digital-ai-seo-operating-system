import { describe, expect, it } from "vitest";
import {
  OffPageSeoRequestValidator,
  OffPageSeoValidationError,
} from "../../../../src/agents/off-page-seo-agent/validation/off-page-seo-request-validator.js";
import type { OffPageSeoRequest } from "../../../../src/agents/off-page-seo-agent/types/off-page-seo-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";
import type { CompetitorIntelligenceResult } from "../../../../src/agents/competitor-intelligence-agent/types/competitor-intelligence-request.types.js";

function makeWebsiteAudit(url: string | null): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url,
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeCompetitorIntelligence(): CompetitorIntelligenceResult {
  return {
    requestId: "ci-1",
    competitorGapAnalysis: [],
    technicalComparison: [],
    contentGapAnalysis: [],
    recommendations: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<OffPageSeoRequest> = {}): OffPageSeoRequest {
  return {
    id: "req-1",
    url: "https://oursite.com/plumbing",
    businessObjective: "Grow emergency plumbing leads.",
    competitorIntelligence: makeCompetitorIntelligence(),
    websiteAudit: makeWebsiteAudit("https://oursite.com/plumbing"),
    ...overrides,
  };
}

describe("OffPageSeoRequestValidator", () => {
  const validator = new OffPageSeoRequestValidator();

  it("accepts a well-formed, internally consistent request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when url is empty", () => {
    expect(() => validator.validate(makeRequest({ url: "   " }))).toThrow(OffPageSeoValidationError);
  });

  it("throws when businessObjective is empty", () => {
    expect(() => validator.validate(makeRequest({ businessObjective: "   " }))).toThrow(OffPageSeoValidationError);
  });

  it("throws when websiteAudit describes a different page than the requested url", () => {
    expect(() =>
      validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit("https://oursite.com/electrical") })),
    ).toThrow(/appears to describe a different page/);
  });

  it("tolerates a null websiteAudit url", () => {
    expect(() => validator.validate(makeRequest({ websiteAudit: makeWebsiteAudit(null) }))).not.toThrow();
  });

  it("findPolicyRiskSignals returns empty for no toxic backlinks", () => {
    expect(validator.findPolicyRiskSignals([])).toEqual([]);
  });

  it("findPolicyRiskSignals reports a signal when toxic backlinks are present", () => {
    const signals = validator.findPolicyRiskSignals([
      { domain: "spammy.example", linkingUrl: "https://spammy.example/page", anchorText: "click here" },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toContain("1 toxic referring domain");
  });
});
