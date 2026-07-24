// Configuration for the Outreach Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: this agent makes no external calls -- it
// only drafts outreach communications for a human to review and send.

import { join } from "node:path";

export interface OutreachAgentConfig {
  readonly auditLogPath: string;
}

export type OutreachAgentConfigOverrides = Partial<OutreachAgentConfig>;

export function loadOutreachAgentConfig(
  overrides: OutreachAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): OutreachAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["OUTREACH_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "outreach-agent", "audit-log.jsonl"),
  };
}
