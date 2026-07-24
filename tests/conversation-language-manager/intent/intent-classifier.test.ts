import { describe, expect, it } from "vitest";
import { IntentClassifier } from "../../../src/conversation-language-manager/intent/intent-classifier.js";

describe("IntentClassifier", () => {
  const classifier = new IntentClassifier();

  it("classifies a short message as needing clarification", () => {
    expect(classifier.classify("help me")).toBe("clarification_needed");
  });

  it("classifies an empty message as needing clarification", () => {
    expect(classifier.classify("   ")).toBe("clarification_needed");
  });

  it("classifies a message with enough real content as a task request", () => {
    expect(classifier.classify("I need help improving my website's SEO rankings.")).toBe("task_request");
  });

  it("treats the word-count threshold as inclusive", () => {
    expect(classifier.classify("audit my website")).toBe("task_request");
  });
});
