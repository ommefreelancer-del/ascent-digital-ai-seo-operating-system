import { describe, expect, it } from "vitest";
import { FollowUpScheduleBuilder } from "../../../../src/agents/outreach-agent/drafting/follow-up-schedule-builder.js";
import type { QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

function makePublisher(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return { url: "https://example.com/blog", domain: "example.com", title: "Example Plumbing Blog", decision: "approved", notes: "x", ...overrides };
}

describe("FollowUpScheduleBuilder", () => {
  const builder = new FollowUpScheduleBuilder();
  const now = new Date("2026-07-01T00:00:00.000Z");

  it("schedules the follow-up 7 real days after the given reference time", () => {
    const entry = builder.build(makePublisher(), null, now);
    expect(entry.scheduledDate).toBe("2026-07-08T00:00:00.000Z");
  });

  it("is the first sequence entry", () => {
    const entry = builder.build(makePublisher(), null, now);
    expect(entry.sequenceNumber).toBe(1);
  });

  it("personalizes the message with the real publisher title and domain", () => {
    const entry = builder.build(makePublisher(), null, now);
    expect(entry.messageDraft).toContain("Example Plumbing Blog");
    expect(entry.messageDraft).toContain("example.com");
  });

  it("uses a bracketed placeholder signature when no sender name is supplied", () => {
    const entry = builder.build(makePublisher(), null, now);
    expect(entry.messageDraft).toContain("[Your Name]");
  });

  it("uses the real sender name when supplied", () => {
    const entry = builder.build(makePublisher(), "Jane Doe", now);
    expect(entry.messageDraft).toContain("Jane Doe");
  });

  it("always requires human approval", () => {
    const entry = builder.build(makePublisher(), null, now);
    expect(entry.requiresApproval).toBe(true);
  });
});
