// In-memory collection of every specialist agent spec available for
// routing. Failing loudly on a malformed spec at startup (rather than
// skipping it silently) is a deliberate choice: routing against an
// incomplete registry would be worse than refusing to start, per
// Engineering Standards SS12 (Data Integrity) and GLOBAL_RULES.md SS1
// (Accuracy First).

import { loadRawAgentSpecFiles } from "./agent-spec-loader.js";
import { parseAgentSpec } from "./agent-spec-parser.js";
import type { AgentSpec } from "../types/agent-spec.types.js";

/**
 * The Boss Agent's own spec file lives alongside the specialist agents in
 * Agents/ but must never be treated as a routing target for itself.
 */
export const BOSS_AGENT_SPEC_ID = "bossagent";

export interface AgentRegistryOptions {
  /** Spec ids to load but exclude from the routable candidate set. */
  readonly excludeIds?: readonly string[];
}

/**
 * The minimal read-only surface that consumers of a loaded agent registry
 * need. TaskRouter and ComplianceValidator depend on this interface rather
 * than the concrete AgentRegistry class so they can be unit-tested with a
 * plain in-memory fake, with no file system involved.
 */
export interface AgentDirectory {
  list(): readonly AgentSpec[];
  getById(id: string): AgentSpec | undefined;
  has(id: string): boolean;
  size(): number;
}

export class AgentRegistry implements AgentDirectory {
  private readonly specsById: ReadonlyMap<string, AgentSpec>;

  private constructor(specsById: ReadonlyMap<string, AgentSpec>) {
    this.specsById = specsById;
  }

  static async load(
    agentsDirectory: string,
    options: AgentRegistryOptions = {},
  ): Promise<AgentRegistry> {
    const excludeIds = new Set(options.excludeIds ?? [BOSS_AGENT_SPEC_ID]);
    const rawFiles = await loadRawAgentSpecFiles(agentsDirectory);

    if (rawFiles.length === 0) {
      throw new Error(`No agent spec files (*.md) were found in "${agentsDirectory}".`);
    }

    const specsById = new Map<string, AgentSpec>();
    const idsSeen = new Map<string, string>();

    for (const rawFile of rawFiles) {
      const spec = parseAgentSpec(rawFile.sourcePath, rawFile.content);

      const previousSourcePath = idsSeen.get(spec.id);
      if (previousSourcePath) {
        throw new Error(
          `Duplicate agent id "${spec.id}" derived from both "${previousSourcePath}" and "${rawFile.sourcePath}".`,
        );
      }
      idsSeen.set(spec.id, rawFile.sourcePath);

      if (!excludeIds.has(spec.id)) {
        specsById.set(spec.id, spec);
      }
    }

    if (specsById.size === 0) {
      throw new Error(
        `All agent specs in "${agentsDirectory}" were excluded; there are no routable specialist agents.`,
      );
    }

    return new AgentRegistry(specsById);
  }

  list(): readonly AgentSpec[] {
    return Array.from(this.specsById.values());
  }

  getById(id: string): AgentSpec | undefined {
    return this.specsById.get(id);
  }

  has(id: string): boolean {
    return this.specsById.has(id);
  }

  size(): number {
    return this.specsById.size;
  }
}
