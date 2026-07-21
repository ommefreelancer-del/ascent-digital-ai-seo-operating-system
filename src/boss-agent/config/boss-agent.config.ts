// Central configuration for the Boss Agent module. Every value has a sane,
// documented default so the module runs with zero required setup, and every
// value can be overridden via an environment variable for deployments where
// the defaults are not appropriate. No secrets are required by this build:
// routing is deterministic and makes no external API calls.

import { join } from "node:path";

export interface BossAgentConfig {
  /** Directory containing the specialist agent spec files (Agents/*.md). */
  readonly agentsDirectory: string;
  /** Directory where per-run task/routing state is written. */
  readonly stateDirectory: string;
  /** File path for the append-only audit log. */
  readonly auditLogPath: string;
  /** Minimum score (0-1) a top candidate must reach to auto-assign. */
  readonly autoAssignThreshold: number;
  /** Minimum lead (0-1) the top candidate must hold over the runner-up. */
  readonly tieMargin: number;
  /** How many ranked candidates to retain on a routing decision. */
  readonly maxCandidates: number;
}

export type BossAgentConfigOverrides = Partial<BossAgentConfig>;

const DEFAULT_AUTO_ASSIGN_THRESHOLD = 0.5;
const DEFAULT_TIE_MARGIN = 0.1;
const DEFAULT_MAX_CANDIDATES = 5;

/**
 * Builds the effective configuration by layering, in increasing priority:
 * built-in defaults, environment variables, then explicit `overrides`
 * (used by tests and by CLI flags).
 */
export function loadBossAgentConfig(
  overrides: BossAgentConfigOverrides = {},
  baseDirectory: string = process.cwd(),
): BossAgentConfig {
  return {
    agentsDirectory:
      overrides.agentsDirectory ??
      process.env["BOSS_AGENT_AGENTS_DIR"] ??
      join(baseDirectory, "Agents"),
    stateDirectory:
      overrides.stateDirectory ??
      process.env["BOSS_AGENT_STATE_DIR"] ??
      join(baseDirectory, "var", "boss-agent", "state"),
    auditLogPath:
      overrides.auditLogPath ??
      process.env["BOSS_AGENT_AUDIT_LOG"] ??
      join(baseDirectory, "var", "boss-agent", "audit-log.jsonl"),
    autoAssignThreshold:
      overrides.autoAssignThreshold ??
      parseNumberEnv(process.env["BOSS_AGENT_AUTO_ASSIGN_THRESHOLD"]) ??
      DEFAULT_AUTO_ASSIGN_THRESHOLD,
    tieMargin:
      overrides.tieMargin ??
      parseNumberEnv(process.env["BOSS_AGENT_TIE_MARGIN"]) ??
      DEFAULT_TIE_MARGIN,
    maxCandidates:
      overrides.maxCandidates ??
      parseNumberEnv(process.env["BOSS_AGENT_MAX_CANDIDATES"]) ??
      DEFAULT_MAX_CANDIDATES,
  };
}

function parseNumberEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
