import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadContentStrategyAgentConfig } from "../../../../src/agents/content-strategy-agent/config/content-strategy-agent.config.js";

const ENV_KEY = "CONTENT_STRATEGY_AGENT_AUDIT_LOG";

describe("loadContentStrategyAgentConfig", () => {
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
    const config = loadContentStrategyAgentConfig({}, "/repo");
    expect(config.auditLogPath).toBe(join("/repo", "var", "content-strategy-agent", "audit-log.jsonl"));
  });

  it("an environment variable overrides the default", () => {
    process.env[ENV_KEY] = "/custom/audit-log.jsonl";
    const config = loadContentStrategyAgentConfig({}, "/repo");
    expect(config.auditLogPath).toBe("/custom/audit-log.jsonl");
  });

  it("an explicit override takes priority over the environment variable", () => {
    process.env[ENV_KEY] = "/custom/audit-log.jsonl";
    const config = loadContentStrategyAgentConfig({ auditLogPath: "/explicit/audit-log.jsonl" }, "/repo");
    expect(config.auditLogPath).toBe("/explicit/audit-log.jsonl");
  });
});
