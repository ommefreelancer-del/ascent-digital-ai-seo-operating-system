// The seam between "the agent needs real, deployable code" and "where that
// code actually comes from". This build has zero runtime dependencies and
// never calls an external service -- GLOBAL_RULES.md SS9 requires explicit
// human approval before "connecting external services" (GitHub, an LLM
// codegen provider, etc, per this agent's own spec) and before "deploying
// production code". No concrete provider ships in this build -- only the
// interface and a NullCodeGenerationProvider that honestly reports
// "unavailable" (see providers/null-code-generation-provider.ts). This
// agent never deploys, commits, or pushes code itself, in this build or any
// future one -- a real provider wired in later would still only ever be
// asked to draft a snippet for human review, never commanded to deploy.

export interface CodeGenerationRequest {
  readonly taskTitle: string;
  readonly taskDescription: string;
  readonly language: string;
}

/** Real, generated code for one task. Never fabricated locally. */
export interface GeneratedCodeSnippet {
  readonly code: string;
  readonly language: string;
}

export interface CodeGenerationProvider {
  readonly name: string;
  /**
   * Resolves to a real, generated code snippet for the requested task, or
   * `null` if generation is unavailable (no provider configured,
   * generation failed, etc). Implementations must never invent placeholder
   * code here -- `null` is always the correct response when real code
   * cannot be produced.
   */
  generateCodeSnippet(request: CodeGenerationRequest): Promise<GeneratedCodeSnippet | null>;
}
