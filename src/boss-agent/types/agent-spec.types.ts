// Structured representation of one specialist agent definition from
// Agents/*.md. This is a read model only: the Boss Agent reads these files to
// know what specialist agents exist and what they are responsible for, and
// never writes to them.

/** The "Communicates With" section of an agent spec. */
export interface AgentCommunication {
  readonly receives: readonly string[];
  readonly sends: readonly string[];
}

/** One specialist agent, as parsed from its Agents/*.md spec file. */
export interface AgentSpec {
  /** Stable identifier derived from the spec's file name, e.g. "keyword-research-agent". */
  readonly id: string;
  /** Absolute path to the source markdown file, kept for traceability. */
  readonly sourcePath: string;
  /** The "# <Title>" heading, e.g. "Keyword Research & Search Intent Agent". */
  readonly title: string;
  readonly mission: string;
  readonly responsibilities: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly communicatesWith: AgentCommunication;
  readonly tools: readonly string[];
  readonly rules: readonly string[];
  readonly successCriteria: readonly string[];
  /**
   * Free-text routing keywords from an optional "## Tags" section, e.g.
   * "seo-audit", "core-web-vitals". Defaults to an empty list for specs that
   * don't declare tags -- purely additive, never required.
   */
  readonly tags: readonly string[];
  /**
   * Concrete, curated capability phrases from an optional "## Capabilities"
   * section, e.g. "crawl a live website", "validate structured data".
   * Distinct from `tags` (short routing keywords) in that these are meant to
   * closely match how a task describes what it needs done. Defaults to an
   * empty list for specs that don't declare capabilities.
   */
  readonly capabilities: readonly string[];
}

/** Raised when a spec file is missing a section the registry treats as mandatory. */
export class AgentSpecParseError extends Error {
  constructor(
    public readonly sourcePath: string,
    message: string,
  ) {
    super(`${sourcePath}: ${message}`);
    this.name = "AgentSpecParseError";
  }
}
