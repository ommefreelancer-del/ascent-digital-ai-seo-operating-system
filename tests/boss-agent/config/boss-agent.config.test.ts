import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBossAgentConfig } from "../../../src/boss-agent/config/boss-agent.config.js";

const ENV_KEYS = [
  "BOSS_AGENT_AGENTS_DIR",
  "BOSS_AGENT_STATE_DIR",
  "BOSS_AGENT_AUDIT_LOG",
  "BOSS_AGENT_AUTO_ASSIGN_THRESHOLD",
  "BOSS_AGENT_TIE_MARGIN",
  "BOSS_AGENT_MAX_CANDIDATES",
] as const;

describe("loadBossAgentConfig", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("derives sane defaults relative to the given base directory", () => {
    const config = loadBossAgentConfig({}, "/repo");

    expect(config.agentsDirectory).toBe(join("/repo", "Agents"));
    expect(config.stateDirectory).toBe(join("/repo", "var", "boss-agent", "state"));
    expect(config.auditLogPath).toBe(join("/repo", "var", "boss-agent", "audit-log.jsonl"));
    expect(config.autoAssignThreshold).toBe(0.5);
    expect(config.tieMargin).toBe(0.1);
    expect(config.maxCandidates).toBe(5);
  });

  it("environment variables override the defaults", () => {
    process.env["BOSS_AGENT_AGENTS_DIR"] = "/custom/agents";
    process.env["BOSS_AGENT_AUTO_ASSIGN_THRESHOLD"] = "0.75";

    const config = loadBossAgentConfig({}, "/repo");

    expect(config.agentsDirectory).toBe("/custom/agents");
    expect(config.autoAssignThreshold).toBe(0.75);
  });

  it("explicit overrides take priority over environment variables", () => {
    process.env["BOSS_AGENT_AGENTS_DIR"] = "/custom/agents";

    const config = loadBossAgentConfig({ agentsDirectory: "/explicit/agents" }, "/repo");

    expect(config.agentsDirectory).toBe("/explicit/agents");
  });

  it("ignores a non-numeric environment override and falls back to the default", () => {
    process.env["BOSS_AGENT_TIE_MARGIN"] = "not-a-number";

    const config = loadBossAgentConfig({}, "/repo");

    expect(config.tieMargin).toBe(0.1);
  });
});
