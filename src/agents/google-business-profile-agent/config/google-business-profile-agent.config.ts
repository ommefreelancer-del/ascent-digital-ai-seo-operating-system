// Configuration for the Google Business Profile Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required: the default NullGbpDataProvider makes no
// external calls, so there is nothing to authenticate against until a real
// provider is deliberately wired in.

import { join } from "node:path";

export interface GoogleBusinessProfileAgentConfig {
  readonly auditLogPath: string;
}

export type GoogleBusinessProfileAgentConfigOverrides = Partial<GoogleBusinessProfileAgentConfig>;

export function loadGoogleBusinessProfileAgentConfig(
  overrides: GoogleBusinessProfileAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): GoogleBusinessProfileAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["GOOGLE_BUSINESS_PROFILE_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "google-business-profile-agent", "audit-log.jsonl"),
  };
}
