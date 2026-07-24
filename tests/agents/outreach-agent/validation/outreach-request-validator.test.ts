import { describe, expect, it } from "vitest";
import {
  OutreachRequestValidator,
  OutreachValidationError,
} from "../../../../src/agents/outreach-agent/validation/outreach-request-validator.js";
import type { OutreachRequest, OutreachDraft, SkippedPublisher } from "../../../../src/agents/outreach-agent/types/outreach-request.types.js";
import type { PublisherQualificationResult } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";
import type { ContactIntelligenceResult } from "../../../../src/agents/contact-intelligence-agent/types/contact-intelligence-request.types.js";

function makePublisherQualification(): PublisherQualificationResult {
  return { requestId: "pq-1", dataAvailable: true, approvedProspects: [], rejectedProspects: [], limitations: [], decidedAt: new Date().toISOString() };
}

function makeContactIntelligence(): ContactIntelligenceResult {
  return { requestId: "ci-1", dataAvailable: true, verifiedRecords: [], unverifiedRecords: [], limitations: [], decidedAt: new Date().toISOString() };
}

function makeRequest(overrides: Partial<OutreachRequest> = {}): OutreachRequest {
  return {
    id: "req-1",
    publisherQualification: makePublisherQualification(),
    contactIntelligence: makeContactIntelligence(),
    campaignRequirements: "Guest post outreach for a plumbing brand.",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<OutreachDraft> = {}): OutreachDraft {
  return {
    domain: "example.com",
    url: "https://example.com",
    title: "Example",
    contactMethod: "email",
    contactValue: "hello@example.com",
    subject: "x",
    body: "x",
    requiresApproval: true,
    ...overrides,
  };
}

function makeSkipped(overrides: Partial<SkippedPublisher> = {}): SkippedPublisher {
  return { domain: "example.com", url: "https://example.com", title: "Example", reason: "x", ...overrides };
}

describe("OutreachRequestValidator", () => {
  const validator = new OutreachRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when campaignRequirements is empty", () => {
    expect(() => validator.validate(makeRequest({ campaignRequirements: "   " }))).toThrow(OutreachValidationError);
  });

  it("looksLowConfidence is false when no data was available at all", () => {
    expect(validator.looksLowConfidence([], [makeSkipped()], false)).toBe(false);
  });

  it("looksLowConfidence is true when real data was available but everything was skipped", () => {
    expect(validator.looksLowConfidence([], [makeSkipped()], true)).toBe(true);
  });

  it("looksLowConfidence is false when at least one real draft was prepared", () => {
    expect(validator.looksLowConfidence([makeDraft()], [], true)).toBe(false);
  });

  it("looksLowConfidence is false when there was nothing to evaluate at all", () => {
    expect(validator.looksLowConfidence([], [], true)).toBe(false);
  });
});
