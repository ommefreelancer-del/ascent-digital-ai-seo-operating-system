// Configuration for the Reply & Negotiation Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullPublisherReplyProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface ReplyNegotiationAgentConfig {
  readonly auditLogPath: string;
}

export type ReplyNegotiationAgentConfigOverrides = Partial<ReplyNegotiationAgentConfig>;

export function loadReplyNegotiationAgentConfig(
  overrides: ReplyNegotiationAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ReplyNegotiationAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["REPLY_NEGOTIATION_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "reply-negotiation-agent", "audit-log.jsonl"),
  };
}
