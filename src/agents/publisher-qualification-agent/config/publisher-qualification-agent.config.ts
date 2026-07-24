// Configuration for the Publisher Qualification Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullPublisherQualityProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface PublisherQualificationAgentConfig {
  readonly auditLogPath: string;
}

export type PublisherQualificationAgentConfigOverrides = Partial<PublisherQualificationAgentConfig>;

export function loadPublisherQualificationAgentConfig(
  overrides: PublisherQualificationAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): PublisherQualificationAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["PUBLISHER_QUALIFICATION_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "publisher-qualification-agent", "audit-log.jsonl"),
  };
}
