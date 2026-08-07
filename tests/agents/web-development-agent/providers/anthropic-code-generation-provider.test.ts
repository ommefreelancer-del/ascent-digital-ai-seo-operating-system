import { describe, expect, it, vi, afterEach } from "vitest";

const REQUEST = {
  taskTitle: "Fix broken mobile nav toggle",
  taskDescription: "The hamburger menu button does not open the nav on screens narrower than 768px.",
  language: "javascript",
};

describe("AnthropicCodeGenerationProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@anthropic-ai/sdk");
    delete process.env["ANTHROPIC_API_KEY"];
  });

  it("returns null when no API key is configured (constructor option or env)", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const { AnthropicCodeGenerationProvider } = await import(
      "../../../../src/agents/web-development-agent/providers/anthropic-code-generation-provider.js"
    );
    const provider = new AnthropicCodeGenerationProvider();
    const result = await provider.generateCodeSnippet(REQUEST);
    expect(result).toBeNull();
  });

  it("returns a real generated snippet when Claude responds with text", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: "document.querySelector('.nav-toggle').addEventListener('click', () => { /* ... */ });" }],
    }));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create: createMock };
      },
    }));

    const { AnthropicCodeGenerationProvider } = await import(
      "../../../../src/agents/web-development-agent/providers/anthropic-code-generation-provider.js"
    );
    const provider = new AnthropicCodeGenerationProvider({ apiKey: "test-key" });
    const result = await provider.generateCodeSnippet(REQUEST);

    expect(result).toEqual({
      code: "document.querySelector('.nav-toggle').addEventListener('click', () => { /* ... */ });",
      language: "javascript",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0]?.[0];
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.taskTitle);
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.taskDescription);
    expect(callArgs?.messages[0]?.content).toContain(REQUEST.language);
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

    const { AnthropicCodeGenerationProvider } = await import(
      "../../../../src/agents/web-development-agent/providers/anthropic-code-generation-provider.js"
    );
    const provider = new AnthropicCodeGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateCodeSnippet(REQUEST)).resolves.toBeNull();
  });

  it("returns null when Claude responds with no text block", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create: vi.fn(async () => ({ content: [{ type: "tool_use" }] })) };
      },
    }));

    const { AnthropicCodeGenerationProvider } = await import(
      "../../../../src/agents/web-development-agent/providers/anthropic-code-generation-provider.js"
    );
    const provider = new AnthropicCodeGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateCodeSnippet(REQUEST)).resolves.toBeNull();
  });
});
