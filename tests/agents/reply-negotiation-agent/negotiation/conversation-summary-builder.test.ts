import { describe, expect, it } from "vitest";
import { ConversationSummaryBuilder } from "../../../../src/agents/reply-negotiation-agent/negotiation/conversation-summary-builder.js";
import type { RawPublisherReply } from "../../../../src/agents/reply-negotiation-agent/types/publisher-reply-provider.types.js";

function makeReply(overrides: Partial<RawPublisherReply> = {}): RawPublisherReply {
  return { replyId: "r1", domain: "example.com", receivedAt: "2026-07-01T00:00:00.000Z", messageText: "Sounds good.", ...overrides };
}

describe("ConversationSummaryBuilder", () => {
  const builder = new ConversationSummaryBuilder();

  it("reports zero replies honestly when there are none", () => {
    const summary = builder.build("example.com", []);
    expect(summary).toEqual({ domain: "example.com", replyCount: 0, latestReplyAt: null, summary: "No real reply has been received yet." });
  });

  it("counts real replies and identifies the real latest one", () => {
    const summary = builder.build("example.com", [
      makeReply({ receivedAt: "2026-07-01T00:00:00.000Z" }),
      makeReply({ receivedAt: "2026-07-05T00:00:00.000Z" }),
    ]);
    expect(summary.replyCount).toBe(2);
    expect(summary.latestReplyAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("does not depend on input order to find the latest reply", () => {
    const summary = builder.build("example.com", [
      makeReply({ receivedAt: "2026-07-05T00:00:00.000Z" }),
      makeReply({ receivedAt: "2026-07-01T00:00:00.000Z" }),
    ]);
    expect(summary.latestReplyAt).toBe("2026-07-05T00:00:00.000Z");
  });
});
