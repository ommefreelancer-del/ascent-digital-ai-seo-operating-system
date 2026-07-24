import { describe, expect, it } from "vitest";
import { SearchIntentClassifier } from "../../../../src/agents/keyword-research-agent/intent/search-intent-classifier.js";

describe("SearchIntentClassifier", () => {
  const classifier = new SearchIntentClassifier();

  it("classifies a purchase-oriented keyword as transactional", () => {
    const result = classifier.classify("buy running shoes online");
    expect(result.intent).toBe("transactional");
    expect(result.rationale).toContain("buy");
  });

  it("classifies a comparison keyword as commercial", () => {
    const result = classifier.classify("best running shoes vs trail shoes");
    expect(result.intent).toBe("commercial");
  });

  it("prioritizes transactional over commercial when both signals are present", () => {
    const result = classifier.classify("best price to buy running shoes");
    expect(result.intent).toBe("transactional");
  });

  it("classifies a login-style keyword as navigational", () => {
    const result = classifier.classify("gmail login");
    expect(result.intent).toBe("navigational");
  });

  it("defaults to informational with an explicit rationale when nothing matches", () => {
    const result = classifier.classify("how does photosynthesis work");
    expect(result.intent).toBe("informational");
    expect(result.rationale).toContain("defaulting to informational");
  });

  it("is case-insensitive", () => {
    expect(classifier.classify("BUY Running Shoes").intent).toBe("transactional");
  });
});
