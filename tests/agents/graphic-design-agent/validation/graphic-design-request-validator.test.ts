import { describe, expect, it } from "vitest";
import {
  GraphicDesignRequestValidator,
  GraphicDesignValidationError,
} from "../../../../src/agents/graphic-design-agent/validation/graphic-design-request-validator.js";
import type { GraphicDesignRequest } from "../../../../src/agents/graphic-design-agent/types/graphic-design-request.types.js";
import type { ContentStrategyResult } from "../../../../src/agents/content-strategy-agent/types/content-strategy-request.types.js";

function makeContentStrategy(): ContentStrategyResult {
  return {
    requestId: "cs-1",
    topicClusters: [],
    pillarPageStrategy: [],
    internalLinkingRecommendations: [],
    editorialCalendar: [],
    contentGaps: [],
    contentBriefs: [],
    limitations: [],
    decidedAt: new Date().toISOString(),
  };
}

function makeRequest(overrides: Partial<GraphicDesignRequest> = {}): GraphicDesignRequest {
  return {
    id: "req-1",
    contentStrategy: makeContentStrategy(),
    ...overrides,
  };
}

describe("GraphicDesignRequestValidator", () => {
  const validator = new GraphicDesignRequestValidator();

  it("accepts a well-formed request", () => {
    expect(() => validator.validate(makeRequest())).not.toThrow();
  });

  it("accepts a request with no optional free-text fields at all", () => {
    expect(() => validator.validate({ id: "req-1", contentStrategy: makeContentStrategy() })).not.toThrow();
  });

  it("throws when marketingRequirements contains a blank entry", () => {
    expect(() => validator.validate(makeRequest({ marketingRequirements: ["Valid one", "   "] }))).toThrow(
      GraphicDesignValidationError,
    );
  });

  it("throws when designRequests contains a blank entry", () => {
    expect(() => validator.validate(makeRequest({ designRequests: [""] }))).toThrow(GraphicDesignValidationError);
  });

  it("findPolicyRiskSignals returns empty for a clean request", () => {
    expect(validator.findPolicyRiskSignals(makeRequest())).toEqual([]);
  });

  it("findPolicyRiskSignals detects stolen-assets signal", () => {
    const signals = validator.findPolicyRiskSignals(makeRequest({ designRequests: ["Just steal the competitor's banner design."] }));
    expect(signals).toContain("using stolen assets");
  });

  it("findPolicyRiskSignals detects unlicensed-assets signal", () => {
    const signals = validator.findPolicyRiskSignals(makeRequest({ brandGuidelines: "Use this stock photo without a license." }));
    expect(signals).toContain("unlicensed assets");
  });

  it("findPolicyRiskSignals never returns duplicate labels", () => {
    const signals = validator.findPolicyRiskSignals(
      makeRequest({ designRequests: ["steal this", "steal that", "just steal it"] }),
    );
    expect(signals).toEqual(["using stolen assets"]);
  });
});
