import { describe, expect, it } from "vitest";
import {
  ProspectingRequestValidator,
  ProspectingValidationError,
} from "../../../../src/agents/prospecting-agent/validation/prospecting-request-validator.js";
import type { ProspectingRequest, Prospect } from "../../../../src/agents/prospecting-agent/types/prospecting-request.types.js";

function makeRequest(overrides: Partial<ProspectingRequest> = {}): ProspectingRequest {
  return {
    id: "req-1",
    campaignRequirements: "Find guest posting opportunities for a plumbing brand.",
    targetNiche: "plumbing",
    targetCountry: "US",
    targetLanguage: "en",
    ...overrides,
  };
}

function makeProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Blog",
    category: "guest-post",
    confidence: "high",
    notes: "x",
    ...overrides,
  };
}

describe("ProspectingRequestValidator", () => {
  const validator = new ProspectingRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignRequirements is empty", () => {
    expect(() => validator.validate(makeRequest({ campaignRequirements: "   " }))).toThrow(ProspectingValidationError);
  });

  it("throws when targetNiche is empty", () => {
    expect(() => validator.validate(makeRequest({ targetNiche: "   " }))).toThrow(ProspectingValidationError);
  });

  it("throws when targetCountry is empty", () => {
    expect(() => validator.validate(makeRequest({ targetCountry: "   " }))).toThrow(ProspectingValidationError);
  });

  it("throws when targetLanguage is empty", () => {
    expect(() => validator.validate(makeRequest({ targetLanguage: "   " }))).toThrow(ProspectingValidationError);
  });

  it("looksLowConfidence is false when no data was available at all", () => {
    expect(validator.looksLowConfidence([], false)).toBe(false);
  });

  it("looksLowConfidence is true when real data was available but zero prospects were found", () => {
    expect(validator.looksLowConfidence([], true)).toBe(true);
  });

  it("looksLowConfidence is true when every real prospect is low confidence", () => {
    expect(validator.looksLowConfidence([makeProspect({ confidence: "low" })], true)).toBe(true);
  });

  it("looksLowConfidence is false when at least one real prospect is medium or high confidence", () => {
    expect(
      validator.looksLowConfidence([makeProspect({ confidence: "low" }), makeProspect({ confidence: "medium" })], true),
    ).toBe(false);
  });
});
