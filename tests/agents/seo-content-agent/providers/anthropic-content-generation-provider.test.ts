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

  it("appends the QA feedback block to the prompt on a revision pass, and omits it on a normal pass", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: "Real revised prose." }],
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

    await provider.generateSection(REQUEST);
    const normalPassPrompt = createMock.mock.calls[0]?.[0]?.messages[0]?.content;
    expect(normalPassPrompt).not.toContain("prior editorial QA pass");

    await provider.generateSection({
      ...REQUEST,
      qaFeedback: { failedChecks: ["h3_used_appropriately"], notes: "No structure in a multi-step section." },
    });
    const revisionPassPrompt = createMock.mock.calls[1]?.[0]?.messages[0]?.content;
    expect(revisionPassPrompt).toContain("prior editorial QA pass");
    expect(revisionPassPrompt).toContain("h3_used_appropriately");
    expect(revisionPassPrompt).toContain("No structure in a multi-step section.");
  });

  const QA_REQUEST = {
    title: "The Complete Guide to Local Plumbing",
    targetKeyword: "local plumber",
    metaTitle: "Local Plumber Guide",
    metaDescription: "Learn about local plumbers.",
    sections: [{ heading: "Introduction", body: "Real intro." }],
    faqs: [] as { question: string; answer: string }[],
  };

  it("evaluateContent tells the QA prompt an FAQ is NOT warranted, and passing faq_useful for its absence is correct", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: '{"passed": true, "failedChecks": [], "notes": "Looks good."}' }],
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
    await provider.evaluateContent({ ...QA_REQUEST, faqExpected: false });

    const prompt = createMock.mock.calls[0]?.[0]?.messages[0]?.content;
    expect(prompt).toContain("NOT warranted");
    expect(prompt).toContain("does NOT include");
    expect(prompt).toContain('Do not fail this for "no FAQ section."');
  });

  it("evaluateContent tells the QA prompt an FAQ IS warranted and includes the outline's own rationale, when the article has one", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: '{"passed": true, "failedChecks": [], "notes": "Looks good."}' }],
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
    await provider.evaluateContent({
      ...QA_REQUEST,
      faqs: [{ question: "How much does a local plumber cost?", answer: "It depends on the job." }],
      faqExpected: true,
      faqRationale: "Readers commonly ask about cost before hiring.",
    });

    const prompt = createMock.mock.calls[0]?.[0]?.messages[0]?.content;
    expect(prompt).toContain("GENUINELY WARRANTED");
    expect(prompt).toContain("DOES include");
    expect(prompt).toContain("Readers commonly ask about cost before hiring.");
  });

  it("still returns null (never throws) for a billing/credit failure when throwOnBillingFailure is not set -- the default, pre-fallback contract is unchanged", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn(async () => {
            const error = new Error(
              '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
            );
            Object.assign(error, { status: 400 });
            throw error;
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

  it("throws ProviderBillingUnavailableError when throwOnBillingFailure is true and the account's credit balance is too low", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn(async () => {
            const error = new Error(
              '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
            );
            Object.assign(error, { status: 400 });
            throw error;
          }),
        };
      },
    }));

    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const { ProviderBillingUnavailableError } = await import(
      "../../../../src/agents/seo-content-agent/providers/provider-billing-unavailable-error.js"
    );
    const provider = new AnthropicContentGenerationProvider({ apiKey: "test-key", throwOnBillingFailure: true });
    await expect(provider.generateSection(REQUEST)).rejects.toBeInstanceOf(ProviderBillingUnavailableError);
  });

  it("still returns null, never throws, when throwOnBillingFailure is true but the failure is unrelated to billing (e.g. a rate limit)", async () => {
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = {
          create: vi.fn(async () => {
            const error = new Error("429 rate limited, please retry later");
            Object.assign(error, { status: 429 });
            throw error;
          }),
        };
      },
    }));

    const { AnthropicContentGenerationProvider } = await import(
      "../../../../src/agents/seo-content-agent/providers/anthropic-content-generation-provider.js"
    );
    const provider = new AnthropicContentGenerationProvider({ apiKey: "test-key", throwOnBillingFailure: true });
    await expect(provider.generateSection(REQUEST)).resolves.toBeNull();
  });

  it("generateFaqQuestions asks for about 4 to 6 real questions, never a restatement of an H2 heading", async () => {
    const createMock = vi.fn(async (_params: { messages: { content: string }[] }) => ({
      content: [{ type: "text", text: '["Is a licensed plumber more expensive than an unlicensed one?"]' }],
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
    await provider.generateFaqQuestions({
      title: "The Complete Guide to Local Plumbing",
      targetKeyword: "local plumber",
      intent: "informational",
      relatedKeywords: [],
      sections: [{ heading: "Introduction", body: "Real intro." }],
    });

    const prompt = createMock.mock.calls[0]?.[0]?.messages[0]?.content;
    expect(prompt).toContain("4 to 6 questions");
    expect(prompt).toContain("never a restatement of one of the article's own H2 headings");
  });
});
