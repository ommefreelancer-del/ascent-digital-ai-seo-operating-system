import { describe, expect, it, vi, afterEach } from "vitest";

const REQUEST = {
  title: "The Complete Guide to Local Plumbing",
  targetKeyword: "local plumber",
  heading: "Why Hire a Licensed Plumber",
  brandGuidelines: null,
  allHeadings: ["Introduction", "Why Hire a Licensed Plumber", "Conclusion"],
  sectionRole: "body" as const,
  relatedKeywords: ["emergency plumber"],
};

describe("GeminiContentGenerationProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@google/genai");
    delete process.env["GOOGLE_GEMINI_API_KEY"];
    delete process.env["GOOGLE_GEMINI_MODEL"];
  });

  it("returns null when no API key is configured (constructor option or env)", async () => {
    delete process.env["GOOGLE_GEMINI_API_KEY"];
    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider();
    const result = await provider.generateSection(REQUEST);
    expect(result).toBeNull();
  });

  it("returns real generated prose when Gemini responds with text", async () => {
    const generateContentMock = vi.fn(async (_params: { model: string; contents: string }) => ({
      text: "Hiring a licensed plumber protects you legally and ensures quality work.",
    }));
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { generateContent: generateContentMock };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    const result = await provider.generateSection(REQUEST);

    expect(result).toEqual({
      heading: "Why Hire a Licensed Plumber",
      body: "Hiring a licensed plumber protects you legally and ensures quality work.",
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentMock.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe("gemini-flash-latest");
    expect(callArgs?.contents).toContain(REQUEST.title);
    expect(callArgs?.contents).toContain(REQUEST.targetKeyword);
    expect(callArgs?.contents).toContain(REQUEST.heading);
  });

  it("uses GOOGLE_GEMINI_MODEL when set, overriding the default", async () => {
    const generateContentMock = vi.fn(async (_params: { model: string; contents: string }) => ({ text: "Some real prose." }));
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { generateContent: generateContentMock };
      },
    }));
    process.env["GOOGLE_GEMINI_MODEL"] = "gemini-2.5-pro";

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    await provider.generateSection(REQUEST);

    expect(generateContentMock.mock.calls[0]?.[0]?.model).toBe("gemini-2.5-pro");
  });

  it("returns null (never throws) when the API call fails", async () => {
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = {
          generateContent: vi.fn(async () => {
            throw new Error("rate limited");
          }),
        };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });

  it("returns null when Gemini responds with no text (empty/malformed response)", async () => {
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { generateContent: vi.fn(async () => ({ text: undefined })) };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });

  it("wires a real AbortSignal into the request, so the 30s internal timeout can actually cancel it", async () => {
    const generateContentMock = vi.fn(async (params: { config?: { abortSignal?: AbortSignal } }) => {
      expect(params.config?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(params.config?.abortSignal?.aborted).toBe(false);
      return { text: "Real prose." };
    });
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = { generateContent: generateContentMock };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    await provider.generateSection(REQUEST);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (never throws) when the request is aborted (simulating a real timeout)", async () => {
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        models = {
          generateContent: vi.fn(async (_params: { config?: { abortSignal?: AbortSignal } }) => {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            throw err;
          }),
        };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "test-key" });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });

  it("never includes the API key in any thrown/returned error path (provider never throws at all)", async () => {
    vi.doMock("@google/genai", () => ({
      GoogleGenAI: class {
        constructor(public options: { apiKey: string }) {}
        models = {
          generateContent: vi.fn(async () => {
            throw new Error("network down");
          }),
        };
      },
    }));

    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    const provider = new GeminiContentGenerationProvider({ apiKey: "super-secret-key" });
    const result = await provider.generateSection(REQUEST);
    expect(result).toBeNull();
  });

  it("has a self-describing name for source attribution", async () => {
    const { GeminiContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/gemini-content-generation-provider.js"
    );
    expect(new GeminiContentGenerationProvider().name).toBe("gemini");
  });
});
