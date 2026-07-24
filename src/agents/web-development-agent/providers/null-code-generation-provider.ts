// The default CodeGenerationProvider: honestly reports that no real code
// generation is available, rather than fabricating any. This is what
// WebDevelopmentAgent.create() uses until a real provider (an approved LLM
// codegen integration) is deliberately wired in and approved per
// GLOBAL_RULES.md SS9 ("connecting external services" requires human
// approval).

import type {
  CodeGenerationProvider,
  CodeGenerationRequest,
  GeneratedCodeSnippet,
} from "../types/code-generation-provider.types.js";

export class NullCodeGenerationProvider implements CodeGenerationProvider {
  readonly name = "none-configured";

  async generateCodeSnippet(_request: CodeGenerationRequest): Promise<GeneratedCodeSnippet | null> {
    return null;
  }
}
