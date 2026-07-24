import { describe, expect, it } from "vitest";
import { OutreachDraftBuilder } from "../../../../src/agents/outreach-agent/drafting/outreach-draft-builder.js";
import type { QualifiedProspect } from "../../../../src/agents/publisher-qualification-agent/types/publisher-qualification-request.types.js";

function makePublisher(overrides: Partial<QualifiedProspect> = {}): QualifiedProspect {
  return {
    url: "https://example.com/blog",
    domain: "example.com",
    title: "Example Plumbing Blog",
    decision: "approved",
    notes: "x",
    ...overrides,
  };
}

describe("OutreachDraftBuilder", () => {
  const builder = new OutreachDraftBuilder();

  it("personalizes the subject and body with the real publisher title and domain", () => {
    const draft = builder.build(makePublisher(), "email", "hello@example.com", "guest posts about plumbing", null);

    expect(draft.subject).toContain("Example Plumbing Blog");
    expect(draft.body).toContain("Example Plumbing Blog");
    expect(draft.body).toContain("example.com");
  });

  it("echoes the real campaign requirements text verbatim", () => {
    const draft = builder.build(makePublisher(), "email", "hello@example.com", "guest posts about plumbing", null);
    expect(draft.body).toContain("guest posts about plumbing");
  });

  it("uses a bracketed placeholder signature when no sender name is supplied", () => {
    const draft = builder.build(makePublisher(), "email", "hello@example.com", "x", null);
    expect(draft.body).toContain("[Your Name]");
  });

  it("uses the real sender name when supplied", () => {
    const draft = builder.build(makePublisher(), "email", "hello@example.com", "x", "Jane Doe");
    expect(draft.body).toContain("Jane Doe");
    expect(draft.body).not.toContain("[Your Name]");
  });

  it("passes through the real contact method and value unchanged", () => {
    const draft = builder.build(makePublisher(), "contact-form", "https://example.com/contact", "x", null);
    expect(draft.contactMethod).toBe("contact-form");
    expect(draft.contactValue).toBe("https://example.com/contact");
  });

  it("always requires human approval", () => {
    const draft = builder.build(makePublisher(), "email", "hello@example.com", "x", null);
    expect(draft.requiresApproval).toBe(true);
  });
});
