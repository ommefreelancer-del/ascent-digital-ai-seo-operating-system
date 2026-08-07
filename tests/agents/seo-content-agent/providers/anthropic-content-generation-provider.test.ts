import { describe, expect, it, vi, afterEach } from "vitest";

const REQUEST = {
  title: "The Complete Guide to Local Plumbing",
  targetKeyword: "local plumber",
  heading: "Why Hire a Licensed Plumber",
  brandGuidelines: null,
};

describe("AnthropicContentGenerationProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@anthropic-ai/sdk");
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("returns null when no API key is configured (constructor option or env)", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const provider = new AnthropicContentGenerationProvider();
    const result = await provider.generateSection(REQUEST);
    expect(result).toBeNull();
  });

  it("returns real generated prose when Claude responds with text", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: "Hiring a licensed plumber protects you legally and ensures quality work." }],
    }));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create: createMock };
      },
    }));

    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const provider = new AnthropicContentGenerationProvider({ apiKey: "test-key" });
    const result = await provider.generateSection(REQUEST);

    expect(result).toEqual({
      heading: "Why Hire a Licensed Plumber",
      body: "Hiring a licensed plumber protects you legally and ensures quality work.",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0]?.[0];
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.title);
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.targetKeyword);
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.heading);
  });

  it("returns null (never throws) when the API call fails", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn(async () => {
            throw new Error("rate limited");
          }),
        };
      },
    }));

    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const provider = new AnthropicContentGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });

  it("returns null when Claude responds with no text block", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create: vi.fn(async () => ({ content: [{ type: "tool_use" }] })) };
      },
    }));

    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const provider = new AnthropicContentGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });
});
