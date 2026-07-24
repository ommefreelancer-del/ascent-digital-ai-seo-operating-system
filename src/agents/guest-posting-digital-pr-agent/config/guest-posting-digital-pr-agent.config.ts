// Configuration for the Guest Posting & Digital PR Agent, following the
// same defaults-plus-env-override-plus-explicit-override pattern as the
// other agents. No secrets are required: this agent makes no external
// calls -- it only consolidates real, already-computed upstream results.

import { join } from "node:path";

export interface GuestPostingDigitalPrAgentConfig {
  readonly auditLogPath: string;
}

export type GuestPostingDigitalPrAgentConfigOverrides = Partial<GuestPostingDigitalPrAgentConfig>;

export function loadGuestPostingDigitalPrAgentConfig(
  overrides: GuestPostingDigitalPrAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): GuestPostingDigitalPrAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["GUEST_POSTING_DIGITAL_PR_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "guest-posting-digital-pr-agent", "audit-log.jsonl"),
  };
}
