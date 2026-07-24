// Configuration for the Google Sheets Integration Agent, following the same
// defaults-plus-env-override-plus-explicit-override pattern as the other
// agents. No secrets are required here: real Google Sheets/Drive API
// credentials, if ever wired in, belong to a concrete GoogleSheetsProvider
// implementation, not this config.

import { join } from "node:path";

export interface GoogleSheetsIntegrationAgentConfig {
  readonly auditLogPath: string;
}

export type GoogleSheetsIntegrationAgentConfigOverrides = Partial<GoogleSheetsIntegrationAgentConfig>;

export function loadGoogleSheetsIntegrationAgentConfig(
  overrides: GoogleSheetsIntegrationAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): GoogleSheetsIntegrationAgentConfig {
  return {
    auditLogPath:
      overrides.auditLogPath ??
      process.env["GOOGLE_SHEETS_INTEGRATION_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "google-sheets-integration-agent", "audit-log.jsonl"),
  };
}
