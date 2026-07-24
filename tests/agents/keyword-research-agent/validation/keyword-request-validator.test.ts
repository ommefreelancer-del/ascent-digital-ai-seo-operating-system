import { describe, expect, it } from "vitest";
import {
  KeywordRequestValidationError,
  KeywordRequestValidator,
} from "../../../../src/agents/keyword-research-agent/validation/keyword-request-validator.js";
import type { KeywordResearchRequest } from "../../../../src/agents/keyword-research-agent/types/keyword-request.types.js";

function makeRequest(overrides: Partial<KeywordResearchRequest> = {}): KeywordResearchRequest {
  return {
    id: "req-1",
    businessObjective: "Grow organic traffic for a home services website.",
    seedKeywords: ["plumber near me", "emergency plumbing"],
    ...overrides,
  };
}

describe("KeywordRequestValidator.validate", () => {
  const validator = new KeywordRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("throws when businessObjective is empty", () => {
    expect(() => validator.validate(makeRequest({ businessObjective: "   " }))).toThrow(
      KeywordRequestValidationError,
    );
  });

  it("throws when seedKeywords is empty", () => {
    expect(() => validator.validate(makeRequest({ seedKeywords: [] }))).toThrow(
      KeywordRequestValidationError,
    );
  });

  it("throws when a seed keyword is blank", () => {
    expect(() => validator.validate(makeRequest({ seedKeywords: ["plumber", "   "] }))).toThrow(
      KeywordRequestValidationError,
    );
  });

  it("throws on a case-insensitive duplicate seed keyword", () => {
    expect(() =>
      validator.validate(makeRequest({ seedKeywords: ["Plumber Near Me", "plumber near me"] })),
    ).toThrow(/Duplicate seed keyword/);
  });
});

describe("KeywordRequestValidator.findPolicyRiskSignals", () => {
  const validator = new KeywordRequestValidator();

  it("returns an empty array for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("flags keyword stuffing language in the business objective", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ businessObjective: "Use keyword stuffing to rank faster." }),
    );
    expect(signals).toContain("keyword stuffing");
  });

  it("flags cloaking, doorway pages, and paid links across seed keywords", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ seedKeywords: ["cloaking technique", "doorway page setup", "buy backlinks cheap"] }),
    );
    expect(signals).toEqual(
      expect.arrayContaining(["cloaking", "doorway pages", "paid/purchased links"]),
    );
  });

  it("does not duplicate a signal matched by more than one field", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({
        businessObjective: "Explore cloaking tactics.",
        seedKeywords: ["cloaking for SEO"],
      }),
    );
    expect(signals.filter((label) => label === "cloaking")).toHaveLength(1);
  });
});
