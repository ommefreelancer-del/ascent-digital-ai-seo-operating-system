import { describe, expect, it } from "vitest";
import {
  ContactIntelligenceRequestValidator,
  ContactIntelligenceValidationError,
} from "../../../../src/agents/contact-intelligence-agent/validation/contact-intelligence-request-validator.js";
import type { ContactIntelligenceRequest, ContactRecord } from "../../../../src/agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";
import type { PublisherQualificationResult } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

function makePublisherQualification(): PublisherQualificationResult {
  return {
    requestId: "pq-1",
    dataAvailable: true,
    approvedProspects: [],
    rejectedProspects: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<ContactIntelligenceRequest> = {}): ContactIntelligenceRequest {
  return {
    id: "req-1",
    publisherQualification: makePublisherQualification(),
    campaignRequirements: "Find contacts for approved guest-post publishers.",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    url: "https://example.com",
    domain: "example.com",
    title: "Example",
    contactMethod: null,
    contactValue: null,
    sourceUrl: null,
    verificationNotes: "x",
    ...overrides,
  };
}

describe("ContactIntelligenceRequestValidator", () => {
  const validator = new ContactIntelligenceRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignRequirements is empty", () => {
    expect(() => validator.validate(makeRequest({ campaignRequirements: "   " }))).toThrow(
      ContactIntelligenceValidationError,
    );
  });

  it("looksLowConfidence is false when no data was available at all", () => {
    expect(validator.looksLowConfidence([], [makeRecord()], false)).toBe(false);
  });

  it("looksLowConfidence is true when real data was available but nothing was verified", () => {
    expect(validator.looksLowConfidence([], [makeRecord()], true)).toBe(true);
  });

  it("looksLowConfidence is false when at least one real record was verified", () => {
    expect(validator.looksLowConfidence([makeRecord()], [], true)).toBe(false);
  });

  it("looksLowConfidence is false when there were no unverified records either (nothing to evaluate)", () => {
    expect(validator.looksLowConfidence([], [], true)).toBe(false);
  });
});
