// Configuration for the Admin Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only organizes real, already-computed upstream results and real,
// caller-supplied administrative context.

import { join } from "node:path";

export interface AdminAgentConfig {
  readonly auditLogPath: string;
}

export type AdminAgentConfigOverrides = Partial<AdminAgentConfig>;

export function loadAdminAgentConfig(
  overrides: AdminAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): AdminAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["ADMIN_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "admin-agent", "audit-log.jsonl"),
  };
}
