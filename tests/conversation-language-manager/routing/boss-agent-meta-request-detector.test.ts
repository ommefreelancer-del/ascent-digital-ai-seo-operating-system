import { describe, expect, it } from "vitest";
import { BossAgentMetaRequestDetector } from "../../../src/conversation-language-manager/routing/boss-agent-meta-request-detector.js";

describe("BossAgentMetaRequestDetector", () => {
  const detector = new BossAgentMetaRequestDetector();

  it.each([
    "Explain why routing failed.",
    "Show routing decision.",
    "Debug Boss Agent.",
    "Handle this request only at the Boss Agent / Orchestrator level",
    "How does the classifier work?",
    "What's in the agent registry?",
    "What confidence score did that get?",
    "Please debug routing.",
    "ROUTING is broken",
  ])("flags %s as a meta-request", (message) => {
    expect(detector.isMetaRequest(message)).toBe(true);
  });

  it.each([
    "Audit my website.",
    "Write a blog about Technical SEO.",
    "Research keywords for AI Automation.",
    "Generate a guest post.",
    "Fix the warnings on my homepage.",
  ])("does not flag an ordinary task request: %s", (message) => {
    expect(detector.isMetaRequest(message)).toBe(false);
  });

  it("matches whole words only, not substrings inside unrelated words", () => {
    // "routing" is a literal substring of "rerouting" -- must not match without a word boundary.
    expect(detector.isMetaRequest("We're rerouting the delivery truck.")).toBe(false);
  });
});
