import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGoogleSheetsIntegrationAgentConfig } from "../../../../src/agents/google-sheets-integration-agent/config/google-sheets-integration-agent.config.js";

const ENV_KEY = "GOOGLE_SHEETS_INTEGRATION_AGENT_AUDIT_LOG";

describe("loadGoogleSheetsIntegrationAgentConfig", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it("derives a sane default relative to the given base directory", () => {
    const config = loadGoogleSheetsIntegrationAgentConfig({}, "/repo");
    expect(config.auditLogPath).toBe(join("/repo", "var", "google-sheets-integration-agent", "audit-log.jsonl"));
  });

  it("an environment variable overrides the default", () => {
    process.env[ENV_KEY] = "/custom/audit-log.jsonl";
    const config = loadGoogleSheetsIntegrationAgentConfig({}, "/repo");
    expect(config.auditLogPath).toBe("/custom/audit-log.jsonl");
  });

  it("an explicit override takes priority over the environment variable", () => {
    process.env[ENV_KEY] = "/custom/audit-log.jsonl";
    const config = loadGoogleSheetsIntegrationAgentConfig({ auditLogPath: "/explicit/audit-log.jsonl" }, "/repo");
    expect(config.auditLogPath).toBe("/explicit/audit-log.jsonl");
  });
});
