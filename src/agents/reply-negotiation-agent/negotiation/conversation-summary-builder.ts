// Builds a deterministic conversation summary from real replies only --
// per the spec's "Summarize conversations for the user" and "Preserve
// complete conversation history" responsibilities. This is a template over
// real counts and dates, not an LLM-written narrative; every real reply is
// reflected in the count, never dropped.

import type { RawPublisherReply } from "../types/publisher-reply-provider.types.js";
import type { ConversationSummary } from "../types/reply-negotiation-request.types.js";

export class ConversationSummaryBuilder {
  build(domain: string, replies: readonly RawPublisherReply[]): ConversationSummary {
    if (replies.length === 0) {
      return { domain, replyCount: 0, latestReplyAt: null, summary: "No real reply has been received yet." };
    }

    const sorted = [...replies].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const latest = sorted[sorted.length - 1] as RawPublisherReply;

    return {
      domain,
      replyCount: replies.length,
      latestReplyAt: latest.receivedAt,
      summary: `${replies.length} real reply(ies) received; most recent on ${latest.receivedAt}.`,
    };
  }
}
