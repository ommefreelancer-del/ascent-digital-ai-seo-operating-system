// The seam between "the agent needs real publisher email replies" and
// "where those replies actually come from". This agent's own rules require
// it to "preserve complete conversation history" and never invent a reply
// -- GLOBAL_RULES.md SS9 requires explicit human approval before
// "connecting external services" (Gmail, another email platform, per this
// agent's own spec). No concrete provider ships in this build -- only the
// interface and a NullPublisherReplyProvider that honestly reports
// "unavailable" (see providers/null-publisher-reply-provider.ts). This
// agent never reads a live inbox itself in this build; a real provider
// wired in later would still only ever be read from, never used to send.

export interface PublisherReplyRequest {
  readonly domain: string;
}

/** One real, received publisher reply, as reported by the provider. Never invented locally. */
export interface RawPublisherReply {
  readonly replyId: string;
  readonly domain: string;
  readonly receivedAt: string;
  readonly messageText: string;
}

export interface PublisherReplySnapshot {
  readonly domain: string;
  readonly replies: readonly RawPublisherReply[];
  /** Which provider supplied this value, for traceability in the audit trail. */
  readonly source: string;
  readonly retrievedAt: string;
}

export interface PublisherReplyProvider {
  readonly name: string;
  /**
   * Resolves to the real reply history for the requested domain, or `null`
   * if no data is available (no provider configured, no mailbox access,
   * etc). Implementations must never invent a reply here -- `null` is
   * always the correct response when genuine reply data cannot be
   * obtained.
   */
  fetchReplies(request: PublisherReplyRequest): Promise<PublisherReplySnapshot | null>;
}
