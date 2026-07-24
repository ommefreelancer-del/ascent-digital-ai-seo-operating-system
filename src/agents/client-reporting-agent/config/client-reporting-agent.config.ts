// Configuration for the Client Reporting Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only synthesizes already-computed upstream results.

import { join } from "node:path";

export interface ClientReportingAgentConfig {
  readonly auditLogPath: string;
}

export type ClientReportingAgentConfigOverrides = Partial<ClientReportingAgentConfig>;

export function loadClientReportingAgentConfig(
  overrides: ClientReportingAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): ClientReportingAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["CLIENT_REPORTING_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "client-reporting-agent", "audit-log.jsonl"),
  };
}
