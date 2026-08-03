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

  // REGRESSION: a real browser test of "Audit https://example.com/page" was
  // misclassified as clarification_needed -- the message is only 2
  // whitespace-separated tokens ("Audit" + the whole URL, since URLs contain
  // no spaces), which fell below MIN_WORDS_FOR_TASK_REQUEST even though a URL
  // is unambiguous, actionable content on its own.
  it("classifies a short message containing a real URL as a task request", () => {
    expect(classifier.classify("Audit https://ommefreelancer-del.github.io/portfolio-website/")).toBe("task_request");
  });

  it("still requires enough real content when no URL is present", () => {
    expect(classifier.classify("hi")).toBe("clarification_needed");
  });
});
