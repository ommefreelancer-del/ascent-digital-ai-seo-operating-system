// Configuration for the Website Audit Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets required: this agent makes no external calls at all.

import { join } from "node:path";

export interface WebsiteAuditAgentConfig {
  readonly auditLogPath: string;
}

export type WebsiteAuditAgentConfigOverrides = Partial<WebsiteAuditAgentConfig>;

export function loadWebsiteAuditAgentConfig(
  overrides: WebsiteAuditAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): WebsiteAuditAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["WEBSITE_AUDIT_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "website-audit-agent", "audit-log.jsonl"),
  };
}
