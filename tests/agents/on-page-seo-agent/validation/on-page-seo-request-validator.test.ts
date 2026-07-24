import { describe, expect, it } from "vitest";
import {
  OnPageSeoRequestValidator,
  OnPageSeoValidationError,
} from "../../../../src/agents/on-page-seo-agent/validation/on-page-seo-request-validator.js";
import type { OnPageSeoRequest } from "../../../../src/agents/on-page-seo-agent/types/on-page-seo-request.types.js";
import type { KeywordResearchResult } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";
import type { WebsiteAuditResult } from "../../../../src/agents/website-audit-agent/types/website-audit-request.types.js";

function makeKeywordResearch(overrides: Partial<KeywordResearchResult> = {}): KeywordResearchResult {
  return {
    requestId: "kw-1",
    classifiedKeywords: [
      { keyword: "plumber near me", intent: "informational", intentRationale: "default", metrics: null },
    ],
    topicClusters: [],
    metricsAvailable: false,
    limitations: [],
    rankingDisclaimer: "No guarantee.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWebsiteAudit(overrides: Partial<WebsiteAuditResult> = {}): WebsiteAuditResult {
  return {
    requestId: "wa-1",
    url: "https://example.com/plumber",
    findings: [],
    summary: { criticalCount: 0, warningCount: 0, infoCount: 0 },
    limitations: [],
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<OnPageSeoRequest> = {}): OnPageSeoRequest {
  return {
    id: "req-1",
    websiteAudit: makeWebsiteAudit(),
    keywordResearch: makeKeywordResearch(),
    targetKeyword: "plumber near me",
    ...overrides,
  };
}

describe("OnPageSeoRequestValidator.validate", () => {
  const validator = new OnPageSeoRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when targetKeyword is empty", () => {
    expect(() => validator.validate(makeRequest({ targetKeyword: "   " }))).toThrow(OnPageSeoValidationError);
  });

  it("throws when targetKeyword was not part of the keyword research", () => {
    expect(() => validator.validate(makeRequest({ targetKeyword: "unrelated keyword" }))).toThrow(
      OnPageSeoValidationError,
    );
  });

  it("matches targetKeyword case-insensitively", () => {
    expect(() => validator.validate(makeRequest({ targetKeyword: "PLUMBER NEAR ME" }))).not.toThrow();
  });
});

describe("OnPageSeoRequestValidator.findPolicyRiskSignals", () => {
  const validator = new OnPageSeoRequestValidator();

  it("returns an empty array for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("flags a policy-risk term in the target keyword", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({
        targetKeyword: "keyword stuffing",
        keywordResearch: makeKeywordResearch({
          classifiedKeywords: [
            { keyword: "keyword stuffing", intent: "informational", intentRationale: "x", metrics: null },
          ],
        }),
      }),
    );
    expect(signals).toContain("keyword stuffing");
  });

  it("flags a policy-risk term appearing in the audit findings' own text", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({
        websiteAudit: makeWebsiteAudit({
          findings: [
            {
              category: "metadata",
              severity: "warning",
              message: "Title appears to use duplicate content from another page.",
              recommendation: "Write unique copy.",
            },
          ],
        }),
      }),
    );
    expect(signals).toContain("duplicate content");
  });
});
