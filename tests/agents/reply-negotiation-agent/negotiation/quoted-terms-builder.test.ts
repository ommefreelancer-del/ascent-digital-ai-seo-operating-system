import { describe, expect, it } from "vitest";
import { QuotedTermsBuilder } from "../../../../src/agents/reply-negotiation-agent/negotiation/quoted-terms-builder.js";
import type { RawPublisherReply } from "../../../../src/agents/reply-negotiation-agent/types/publisher-reply-provider.types.js";

function makeReply(overrides: Partial<RawPublisherReply> = {}): RawPublisherReply {
  return { replyId: "r1", domain: "example.com", receivedAt: "2026-07-01T00:00:00.000Z", messageText: "Sounds good.", ...overrides };
}

describe("QuotedTermsBuilder", () => {
  const builder = new QuotedTermsBuilder();

  it("reports not-quoted with null fields when there are no real replies", () => {
    const terms = builder.build("example.com", []);
    expect(terms).toEqual({ domain: "example.com", status: "not-quoted", quotedPrice: null, rawQuoteText: null });
  });

  it("reports not-quoted when no real reply mentions a price", () => {
    const terms = builder.build("example.com", [makeReply({ messageText: "Let me check with my team." })]);
    expect(terms.status).toBe("not-quoted");
  });

  it("extracts the real price from the most recent reply", () => {
    const terms = builder.build("example.com", [
      makeReply({ receivedAt: "2026-07-01T00:00:00.000Z", messageText: "We usually charge $300." }),
      makeReply({ receivedAt: "2026-07-05T00:00:00.000Z", messageText: "Actually, for you we can do $150." }),
    ]);
    expect(terms.status).toBe("quoted");
    expect(terms.quotedPrice).toBe(150);
  });

  it("falls back to an earlier reply's real price when the latest reply has none", () => {
    const terms = builder.build("example.com", [
      makeReply({ receivedAt: "2026-07-01T00:00:00.000Z", messageText: "We charge $300." }),
      makeReply({ receivedAt: "2026-07-05T00:00:00.000Z", messageText: "Let us know if that works." }),
    ]);
    expect(terms.status).toBe("quoted");
    expect(terms.quotedPrice).toBe(300);
  });
});
