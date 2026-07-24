import { describe, expect, it } from "vitest";
import { NullPublisherReplyProvider } from "../../../../src/agents/reply-negotiation-agent/providers/null-publisher-reply-provider.js";

describe("NullPublisherReplyProvider", () => {
  it("has a self-describing name", () => {
    expect(new NullPublisherReplyProvider().name).toBe("none-configured");
  });

  it("always resolves to null, never a fabricated reply", async () => {
    const provider = new NullPublisherReplyProvider();
    const result = await provider.fetchReplies({ domain: "example.com" });
    expect(result).toBeNull();
  });
});
