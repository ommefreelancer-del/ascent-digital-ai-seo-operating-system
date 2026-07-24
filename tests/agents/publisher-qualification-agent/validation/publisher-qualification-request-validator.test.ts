import { describe, expect, it } from "vitest";
import {
  PublisherQualificationRequestValidator,
  PublisherQualificationValidationError,
} from "../../../../src/agents/publisher-qualification-agent/validation/publisher-qualification-request-validator.js";
import type { PublisherQualificationRequest, QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ProspectingResult } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

function makeProspecting(): ProspectingResult {
  return {
    requestId: "pr-1",
    dataAvailable: true,
    prospects: [],
    duplicatesRemoved: 0,
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<PublisherQualificationRequest> = {}): PublisherQualificationRequest {
  return {
    id: "req-1",
    prospecting: makeProspecting(),
    campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
    targetNiche: "plumbing",
    ...overrides,
  };
}

function makeQualified(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com", domain: "example.com", title: "Example", decision: "rejected", notes: "x", ...overrides };
}

describe("PublisherQualificationRequestValidator", () => {
  const validator = new PublisherQualificationRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignRequirements is empty", () => {
    expect(() => validator.validate(makeRequest({ campaignRequirements: "   " }))).toThrow(
      PublisherQualificationValidationError,
    );
  });

  it("throws when targetNiche is empty", () => {
    expect(() => validator.validate(makeRequest({ targetNiche: "   " }))).toThrow(PublisherQualificationValidationError);
  });

  it("looksLowConfidence is false when no data was available at all", () => {
    expect(validator.looksLowConfidence([], [makeQualified()], false)).toBe(false);
  });

  it("looksLowConfidence is true when real data was available but nothing was approved", () => {
    expect(validator.looksLowConfidence([], [makeQualified()], true)).toBe(true);
  });

  it("looksLowConfidence is false when at least one real prospect was approved", () => {
    expect(validator.looksLowConfidence([makeQualified({ decision: "approved" })], [], true)).toBe(false);
  });

  it("looksLowConfidence is false when there were no rejected prospects either (nothing to evaluate)", () => {
    expect(validator.looksLowConfidence([], [], true)).toBe(false);
  });
});
