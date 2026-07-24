// Configuration for the Prospecting Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullProspectDiscoveryProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface ProspectingAgentConfig {
  readonly auditLogPath: string;
}

export type ProspectingAgentConfigOverrides = Partial<ProspectingAgentConfig>;

export function loadProspectingAgentConfig(
  overrides: ProspectingAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ProspectingAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["PROSPECTING_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "prospecting-agent", "audit-log.jsonl"),
  };
}
