// Drafts one task's code via the injected CodeGenerationProvider, and
// assembles the full DevelopmentTask. With no provider configured (the
// default), or when the provider cannot produce real code for this task,
// the snippet is a bracketed placeholder instruction -- never fabricated
// code standing in for a real implementation. Every task requires approval
// before deployment, per GLOBAL_RULES.md SS9 -- this agent never deploys
// anything itself.

import type { CodeGenerationProvider } from "../types/code-generation-provider.types.js";
import type { DevelopmentTask, DevelopmentTaskCategory, DraftDevelopmentTask } from "../types/web-development-request.types.js";

/**
 * A documented, general convention for which language a task's snippet is
 * drafted in, not a claim about a specific codebase's stack.
 */
const LANGUAGE_BY_CATEGORY: Record<DevelopmentTaskCategory, string> = {
  "bug-fix": "javascript",
  feature: "html",
  "seo-implementation": "html",
};

export class CodeSnippetDrafter {
  async draftTask(provider: CodeGenerationProvider, draft: DraftDevelopmentTask): Promise<DevelopmentTask> {
    const language = LANGUAGE_BY_CATEGORY[draft.category];
    const generated = await provider.generateCodeSnippet({
      taskTitle: draft.title,
      taskDescription: draft.description,
      language,
    });

    if (generated) {
      return { ...draft, codeSnippet: generated.code, isCodeGenerated: true, requiresApproval: true };
    }

    return {
      ...draft,
      codeSnippet:
        `[Code not generated -- no CodeGenerationProvider is configured. Implement "${draft.title}" in ` +
        `${language}, satisfying: ${draft.acceptanceCriteria.join(" ")}]`,
      isCodeGenerated: false,
      requiresApproval: true,
    };
  }
}
