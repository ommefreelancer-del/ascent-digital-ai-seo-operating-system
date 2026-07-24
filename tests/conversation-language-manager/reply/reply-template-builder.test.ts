import { describe, expect, it } from "vitest";
import { ReplyTemplateBuilder } from "../../../src/conversation-language-manager/reply/reply-template-builder.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    taskId: "task-1",
    status: "assigned",
    assignedAgentId: "keyword-research-agent",
    candidates: [],
    rationale: "Matched on real keyword terms.",
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ReplyTemplateBuilder", () => {
  const builder = new ReplyTemplateBuilder();

  it("builds an English clarification reply", () => {
    expect(builder.clarification("en")).toContain("more detail");
  });

  it("builds an Urdu clarification reply", () => {
    expect(builder.clarification("ur")).toContain("تفصیل");
  });

  it("builds an English reply for an assigned decision", () => {
    const reply = builder.routing(makeDecision(), "en");
    expect(reply).toContain("keyword-research-agent");
    expect(reply).toContain("Matched on real keyword terms.");
  });

  it("builds an Urdu reply for an assigned decision", () => {
    const reply = builder.routing(makeDecision(), "ur");
    expect(reply).toContain("keyword-research-agent");
  });

  it("builds a reply for an escalated decision", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "escalated",
      candidates: [],
      rationale: "Ambiguous match.",
      decidedAt: new Date().toISOString(),
    };
    const reply = builder.routing(decision, "en");
    expect(reply).toContain("human review");
    expect(reply).toContain("Ambiguous match.");
  });

  it("builds a reply for a rejected decision", () => {
    const decision: RoutingDecision = {
      taskId: "task-1",
      status: "rejected",
      candidates: [],
      rationale: "Declined.",
      decidedAt: new Date().toISOString(),
    };
    const reply = builder.routing(decision, "en");
    expect(reply).toContain("not assigned");
    expect(reply).toContain("Declined.");
  });
});
