// Configuration for the Contact Intelligence Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullContactDiscoveryProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface ContactIntelligenceAgentConfig {
  readonly auditLogPath: string;
}

export type ContactIntelligenceAgentConfigOverrides = Partial<ContactIntelligenceAgentConfig>;

export function loadContactIntelligenceAgentConfig(
  overrides: ContactIntelligenceAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ContactIntelligenceAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CONTACT_INTELLIGENCE_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "contact-intelligence-agent", "audit-log.jsonl"),
  };
}
