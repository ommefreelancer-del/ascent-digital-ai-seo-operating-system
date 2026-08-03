// Generates the specialist agent's actual reply via the Anthropic API, once
// the Boss Agent (frozen backend, untouched by this module) has already
// decided which specialist agent a task is assigned to. This module never
// influences routing -- it only runs after a RoutingDecision already exists,
// and role-plays the assigned specialist using its own real Agents/*.md spec
// (mission, responsibilities, rules) as the system prompt.

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-5";

export interface SpecialistAgentSpec {
  readonly id: string;
  readonly title: string;
  readonly mission: string;
  readonly responsibilities: readonly string[];
  readonly rules: readonly string[];
}

let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  client = apiKey ? new Anthropic({ apiKey }) : null;
  return client;
}

function buildSystemPrompt(spec: SpecialistAgentSpec): string {
  const responsibilities = spec.responsibilities.map((r) => `- ${r}`).join("\n");
  const rules = spec.rules.map((r) => `- ${r}`).join("\n");
  return [
    `You are the "${spec.title}" inside ADASOS (Ascent Digital AI SEO Operating System).`,
    `Mission: ${spec.mission}`,
    `Responsibilities:\n${responsibilities}`,
    `Rules you must follow:\n${rules}`,
    "Respond directly to the user's request as this specialist agent, in plain language. " +
      "Never fabricate data you were not given (metrics, rankings, backlinks). If you lack information needed for a " +
      "precise answer, say so and ask for it or give best-practice guidance instead.",
  ].join("\n\n");
}

/** Thrown when ANTHROPIC_API_KEY is not configured. Callers should surface this as a clear, non-fatal message. */
export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured, so the specialist agent cannot generate a response.");
    this.name = "AnthropicNotConfiguredError";
  }
}

// claude-sonnet-5 runs adaptive thinking by default -- it isn't optional
// output, it shares max_tokens with the final text. A real production
// request ("Create a complete SEO campaign..." -- 8 sub-tasks) hit
// stop_reason "max_tokens" with 1847 of 2048 tokens spent on thinking,
// leaving no room for a text block at all: message.content.find(...) found
// nothing and generateSpecialistReply threw "Claude returned no text
// content." 2048 was never enough headroom for both. max_tokens is raised
// well past what adaptive thinking plus a full specialist reply need, and
// effort is capped at "medium" so thinking itself doesn't grow unbounded on
// multi-part requests -- both confirmed against a real API call reproducing
// the failing request (see tests/server/backend/specialist-ai.test.ts).
const MAX_TOKENS = 8192;
const EFFORT = "medium";

/** Calls Claude, role-playing the given specialist agent, to produce the real final reply to the user's task. */
export async function generateSpecialistReply(spec: SpecialistAgentSpec, userMessage: string, routingRationale: string): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) {
    console.error("[specialist-ai] ANTHROPIC_API_KEY not configured -- cannot call the model.");
    throw new AnthropicNotConfiguredError();
  }

  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  console.log(`[specialist-ai] Calling ${model} for "${spec.title}" (max_tokens=${MAX_TOKENS}, effort=${EFFORT}).`);

  const message = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    system: buildSystemPrompt(spec),
    messages: [
      {
        role: "user",
        content: `The Boss Agent routed this task to you. Routing rationale: ${routingRationale}\n\nUser's request: ${userMessage}`,
      },
    ],
  });

  const thinkingTokens = message.usage.output_tokens_details?.thinking_tokens ?? 0;
  console.log(
    `[specialist-ai] Response received: stop_reason=${message.stop_reason}, ` +
      `content_blocks=[${message.content.map((b) => b.type).join(", ")}], ` +
      `output_tokens=${message.usage.output_tokens} (thinking=${thinkingTokens}).`,
  );

  const text = message.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
  if (!text) {
    console.error(
      `[specialist-ai] No text block in response for "${spec.title}" -- stop_reason=${message.stop_reason}, ` +
        `content types=[${message.content.map((b) => b.type).join(", ")}].`,
    );
    throw new Error(
      message.stop_reason === "max_tokens"
        ? `Claude ran out of output tokens (max_tokens=${MAX_TOKENS}) before producing a text response.`
        : "Claude returned no text content.",
    );
  }
  return text;
}
