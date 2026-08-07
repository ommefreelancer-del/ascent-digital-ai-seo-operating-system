// A real ContentGenerationProvider backed by the Anthropic API, following
// the exact pattern already proven in web/src/server/backend/specialist-ai.ts
// (same @anthropic-ai/sdk usage, same ANTHROPIC_API_KEY/ANTHROPIC_MODEL env
// var convention). This is an explicit opt-in: SeoContentAgent.create()
// still defaults to NullContentGenerationProvider, consistent with
// GLOBAL_RULES.md SS9 ("connecting external services" requires deliberate
// configuration, not a silent default).
//
// On any failure (no API key configured, the API call fails, Claude returns
// no text), this returns `null` rather than fabricating placeholder prose --
// the same "unavailable, not guessed" contract every provider in this
// codebase follows.

import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentGenerationProvider,
  ContentGenerationRequest,
  GeneratedSection,
} from "../types/content-generation-provider.types.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;

function buildPrompt(request: ContentGenerationRequest): string {
  const brandLine = request.brandGuidelines
    ? `Brand voice/tone guidance: ${request.brandGuidelines}`
    : "No specific brand voice guidance was supplied; write in a clear, professional, people-first tone.";

  return [
    `Write the body copy for one section of an SEO-optimized article.`,
    `Article title: "${request.title}"`,
    `Target keyword: "${request.targetKeyword}"`,
    `Section heading: "${request.heading}"`,
    brandLine,
    "Write only the section's body prose (no heading, no markdown title, no preamble like 'Here is the section'). " +
      "Keep it factually conservative: never invent statistics, dates, prices, testimonials, or claims about the " +
      "business that were not given to you. If the section calls for a specific fact you don't have, write around " +
      "it generically rather than inventing one. Aim for 2-4 short paragraphs.",
  ].join("\n\n");
}

export class AnthropicContentGenerationProvider implements ContentGenerationProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    const apiKey = options.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    this.model = options.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
  }

  async generateSection(request: ContentGenerationRequest): Promise<GeneratedSection | null> {
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

      return { heading: request.heading, body: text.trim() };
    } catch {
      return null;
    }
  }
}
