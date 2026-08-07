// A real CodeGenerationProvider backed by the Anthropic API, following the
// exact pattern already proven in
// src/agents/seo-content-agent/providers/anthropic-content-generation-provider.ts
// (same @anthropic-ai/sdk usage, same ANTHROPIC_API_KEY/ANTHROPIC_MODEL env
// var convention). This is an explicit opt-in: WebDevelopmentAgent.create()
// still defaults to NullCodeGenerationProvider, consistent with
// GLOBAL_RULES.md SS9 ("connecting external services" requires deliberate
// configuration, not a silent default).
//
// This only ever drafts a snippet for human review -- code-snippet-drafter.ts
// always marks the result `requiresApproval: true`, and this agent never
// deploys, commits, or pushes code in this build or any future one.
//
// On any failure (no API key configured, the API call fails, Claude returns
// no text), this returns `null` rather than fabricating placeholder code --
// the same "unavailable, not guessed" contract every provider in this
// codebase follows.

import Anthropic from "@anthropic-ai/sdk";
import type {
  CodeGenerationProvider,
  CodeGenerationRequest,
  GeneratedCodeSnippet,
} from "../types/code-generation-provider.types.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

function buildPrompt(request: CodeGenerationRequest): string {
  return [
    `Write a real, working ${request.language} code snippet for the following web development task. This is a DRAFT for human review -- it will never be deployed automatically.`,
    `Task: "${request.taskTitle}"`,
    `Description: ${request.taskDescription}`,
    "Return only the code itself, with brief inline comments where genuinely helpful. No prose before or after the code, no markdown code fences. " +
      "Keep it factually conservative: never invent API endpoints, credentials, file paths, or business logic that were not described. " +
      "If the task requires information you don't have (e.g. a specific existing file's contents), write the snippet around that gap and note the assumption in a comment.",
  ].join("\n\n");
}

export class AnthropicCodeGenerationProvider implements CodeGenerationProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = options.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
  }

  async generateCodeSnippet(request: CodeGenerationRequest): Promise<GeneratedCodeSnippet | null> {
    if (!this.client) {
      return null;
    }

    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: buildPrompt(request) }],
      });

      const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
      if (!text) {
        return null;
      }

      return { code: text.trim(), language: request.language };
    } catch {
      return null;
    }
  }
}
