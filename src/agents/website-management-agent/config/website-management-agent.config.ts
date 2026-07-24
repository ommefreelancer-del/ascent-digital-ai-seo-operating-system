// Configuration for the Website Management Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullWebsiteManagementProvider
// makes no external calls, so there is nothing to authenticate against
// until a real provider is deliberately wired in.

import { join } from "node:path";

export interface WebsiteManagementAgentConfig {
  readonly auditLogPath: string;
}

export type WebsiteManagementAgentConfigOverrides = Partial<WebsiteManagementAgentConfig>;

export function loadWebsiteManagementAgentConfig(
  overrides: WebsiteManagementAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): WebsiteManagementAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["WEBSITE_MANAGEMENT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "website-management-agent", "audit-log.jsonl"),
  };
}
