import { describe, expect, it } from "vitest";
import { pickPreferredContact } from "../../../../src/agents/contact-intelligence-agent/contact/contact-method-preference.js";
import type { RawContactCandidate } from "../../../../src/agents/contact-intelligence-agent/types/contact-discovery-provider.types.js";

function makeCandidate(overrides: Partial<RawContactCandidate> = {}): RawContactCandidate {
  return { method: "phone", value: "555-1234", isVerified: true, sourceUrl: "https://example.com/contact", ...overrides };
}

describe("pickPreferredContact", () => {
  it("prefers email over any other real method", () => {
    const email = makeCandidate({ method: "email", value: "hello@example.com" });
    const phone = makeCandidate({ method: "phone" });
    expect(pickPreferredContact([phone, email])).toBe(email);
  });

  it("prefers a contact form over social media or phone", () => {
    const form = makeCandidate({ method: "contact-form", value: "https://example.com/contact-form" });
    const social = makeCandidate({ method: "social-media", value: "@example" });
    expect(pickPreferredContact([social, form])).toBe(form);
  });

  it("prefers social media over phone", () => {
    const social = makeCandidate({ method: "social-media", value: "@example" });
    const phone = makeCandidate({ method: "phone" });
    expect(pickPreferredContact([phone, social])).toBe(social);
  });

  it("returns the only candidate when there is just one", () => {
    const phone = makeCandidate({ method: "phone" });
    expect(pickPreferredContact([phone])).toBe(phone);
  });
});
