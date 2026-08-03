import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialistAgentSpec } from "../../../src/server/backend/specialist-ai";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: createMock },
  })),
}));

const SPEC: SpecialistAgentSpec = {
  id: "seo-content-agent",
  title: "SEO Content Agent (Content Writing)",
  mission: "Create high-quality, original, SEO-optimized content that satisfies user intent.",
  responsibilities: ["Write SEO-friendly blog posts.", "Write guest posts."],
  rules: ["Follow GLOBAL_RULES.md.", "Never fabricate data."],
};

describe("generateSpecialistReply", () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    delete process.env.ANTHROPIC_MODEL;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it("returns the response text on a normal successful call", async () => {
    createMock.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Here is your SEO blog post..." }],
      usage: { output_tokens: 500, output_tokens_details: { thinking_tokens: 100 } },
    });

    const { generateSpecialistReply } = await import("../../../src/server/backend/specialist-ai");
    const result = await generateSpecialistReply(SPEC, "Write a blog about Technical SEO.", "rationale");

    expect(result).toBe("Here is your SEO blog post...");
  });

  // REGRESSION: a real production request ("Create a complete SEO campaign
  // for Ascent Digital's AI Automation service..." -- an 8-step, multi-part
  // task) hit stop_reason "max_tokens" with 1847 of the old 2048-token budget
  // spent on claude-sonnet-5's always-on adaptive thinking, leaving zero room
  // for a text block. generateSpecialistReply then threw "Claude returned no
  // text content." even though the model never actually failed -- it just
  // never got to write an answer. Confirmed via a real, non-mocked API call
  // reproducing the exact failing request before this fix.
  it("requests enough max_tokens headroom for adaptive thinking to still leave room for text", async () => {
    createMock.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: { output_tokens: 10, output_tokens_details: { thinking_tokens: 5 } },
    });

    const { generateSpecialistReply } = await import("../../../src/server/backend/specialist-ai");
    await generateSpecialistReply(
      SPEC,
      "Create a complete SEO campaign for Ascent Digital's AI Automation service.",
      "rationale",
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    const requestArgs = createMock.mock.calls[0]![0];
    expect(requestArgs.max_tokens).toBeGreaterThanOrEqual(8192);
    expect(requestArgs.output_config?.effort).toBeTruthy();
  });

  it("throws a clear, diagnosable error when thinking consumes the whole budget and no text block is produced", async () => {
    createMock.mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "", signature: "abc" }],
      usage: { output_tokens: 8192, output_tokens_details: { thinking_tokens: 8192 } },
    });

    const { generateSpecialistReply } = await import("../../../src/server/backend/specialist-ai");
    await expect(generateSpecialistReply(SPEC, "some request", "rationale")).rejects.toThrow(/max_tokens/);
  });

  it("throws AnthropicNotConfiguredError when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { generateSpecialistReply, AnthropicNotConfiguredError } = await import(
      "../../../src/server/backend/specialist-ai"
    );
    await expect(generateSpecialistReply(SPEC, "x", "y")).rejects.toBeInstanceOf(AnthropicNotConfiguredError);
  });
});
