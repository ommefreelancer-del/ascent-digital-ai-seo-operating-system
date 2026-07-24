// The default PublisherReplyProvider: honestly reports that no real
// publisher reply data is available, rather than fabricating any. This is
// what ReplyNegotiationAgent.create() uses until a real provider (Gmail or
// another approved email platform integration) is deliberately wired in
// and approved per GLOBAL_RULES.md SS9 ("connecting external services"
// requires human approval).

import type {
  PublisherReplyProvider,
  PublisherReplyRequest,
  PublisherReplySnapshot,
} from "../types/publisher-reply-provider.types.js";

export class NullPublisherReplyProvider implements PublisherReplyProvider {
  readonly name = "none-configured";

  async fetchReplies(_request: PublisherReplyRequest): Promise<PublisherReplySnapshot | null> {
    return null;
  }
}
