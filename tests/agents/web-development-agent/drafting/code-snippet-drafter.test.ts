import { describe, expect, it } from "vitest";
import { CodeSnippetDrafter } from "../../../../src/agents/web-development-agent/drafting/code-snippet-drafter.js";
import { NullCodeGenerationProvider } from "../../../../src/agents/web-development-agent/providers/null-code-generation-provider.js";
import type {
  CodeGenerationProvider,
  CodeGenerationRequest,
  GeneratedCodeSnippet,
} from "../../../../src/agents/web-development-agent/types/code-generation-provider.types.js";
import type { DraftDevelopmentTask } from "../../../../src/agents/web-development-agent/types/web-development-request.types.js";

class FixedCodeGenerationProvider implements CodeGenerationProvider {
  readonly name = "fixed-test-provider";
  constructor(private readonly snippet: GeneratedCodeSnippet | null) {}
  async generateCodeSnippet(_request: CodeGenerationRequest): Promise<GeneratedCodeSnippet | null> {
    return this.snippet;
  }
}

function makeDraft(overrides: Partial<DraftDevelopmentTask> = {}): DraftDevelopmentTask {
  return {
    category: "bug-fix",
    priority: "high",
    title: "Fix: broken contact link",
    description: "The contact link is broken.",
    rationale: "Caller-supplied bug report.",
    acceptanceCriteria: ["The reported bug no longer reproduces."],
    ...overrides,
  };
}

describe("CodeSnippetDrafter", () => {
  const drafter = new CodeSnippetDrafter();

  it("produces a bracketed placeholder when the provider returns no real code", async () => {
    const task = await drafter.draftTask(new NullCodeGenerationProvider(), makeDraft());

    expect(task.isCodeGenerated).toBe(false);
    expect(task.codeSnippet).toMatch(/^\[.*\]$/);
    expect(task.codeSnippet).toContain("Fix: broken contact link");
    expect(task.requiresApproval).toBe(true);
  });

  it("uses the provider's real generated code when it supplies one", async () => {
    const provider = new FixedCodeGenerationProvider({ code: "<a href=\"/contact\">Contact</a>", language: "html" });
    const task = await drafter.draftTask(provider, makeDraft());

    expect(task.isCodeGenerated).toBe(true);
    expect(task.codeSnippet).toBe('<a href="/contact">Contact</a>');
    expect(task.requiresApproval).toBe(true);
  });

  it("preserves every field from the draft task unchanged", async () => {
    const draft = makeDraft({ title: "Fix: X", priority: "medium" });
    const task = await drafter.draftTask(new NullCodeGenerationProvider(), draft);

    expect(task.title).toBe("Fix: X");
    expect(task.priority).toBe("medium");
    expect(task.category).toBe("bug-fix");
  });
});
