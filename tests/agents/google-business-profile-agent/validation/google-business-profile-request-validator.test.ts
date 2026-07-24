import { describe, expect, it } from "vitest";
import {
  GoogleBusinessProfileRequestValidator,
  GoogleBusinessProfileValidationError,
} from "../../../../src/agents/google-business-profile-agent/validation/google-business-profile-request-validator.js";
import type { GoogleBusinessProfileRequest } from "../../../../src/agents/google-business-profile-agent/types/google-business-profile-request.types.js";

function makeRequest(overrides: Partial<GoogleBusinessProfileRequest> = {}): GoogleBusinessProfileRequest {
  return {
    id: "req-1",
    businessName: "Acme Plumbing",
    websiteUrl: "https://oursite.com",
    expectedNap: { name: "Acme Plumbing", address: "123 Main St", phone: "555-1234" },
    ...overrides,
  };
}

describe("GoogleBusinessProfileRequestValidator", () => {
  const validator = new GoogleBusinessProfileRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when businessName is empty", () => {
    expect(() => validator.validate(makeRequest({ businessName: "   " }))).toThrow(GoogleBusinessProfileValidationError);
  });

  it("throws when websiteUrl is empty", () => {
    expect(() => validator.validate(makeRequest({ websiteUrl: "   " }))).toThrow(GoogleBusinessProfileValidationError);
  });

  it("throws when expectedNap has a blank field", () => {
    expect(() =>
      validator.validate(makeRequest({ expectedNap: { name: "Acme", address: "  ", phone: "555-1234" } })),
    ).toThrow(/expectedNap must include/);
  });

  it("findPolicyRiskSignals returns empty for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("findPolicyRiskSignals detects a fake-reviews signal", () => {
    const signals = validator.findPolicyRiskSignals(makeRequest({ localSeoStrategy: "Post some fake reviews to boost rating." }));
    expect(signals).toContain("fake reviews");
  });

  it("findPolicyRiskSignals detects a keyword-stuffed business name", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ businessName: "Acme Plumbing Keyword Stuffing Best Plumber Near Me" }),
    );
    expect(signals).toContain("keyword stuffing");
  });

  it("findPolicyRiskSignals detects a virtual office signal", () => {
    const signals = validator.findPolicyRiskSignals(makeRequest({ localSeoStrategy: "Use a virtual office address for this listing." }));
    expect(signals).toContain("virtual office address");
  });

  it("findPolicyRiskSignals never returns duplicate labels", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ localSeoStrategy: "fake review fake review fake review" }),
    );
    expect(signals).toEqual(["fake reviews"]);
  });
});
