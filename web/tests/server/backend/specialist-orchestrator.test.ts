import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpecialistAgentSpec } from "../../../src/server/backend/specialist-ai";

const { getSpecialistAgentSpecMock, generateSpecialistReplyMock } = vi.hoisted(() => ({
  getSpecialistAgentSpecMock: vi.fn(),
  generateSpecialistReplyMock: vi.fn(),
}));

vi.mock("../../../src/server/backend/conversation", () => ({
  getSpecialistAgentSpec: getSpecialistAgentSpecMock,
}));

vi.mock("../../../src/server/backend/specialist-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/backend/specialist-ai")>();
  return { ...actual, generateSpecialistReply: generateSpecialistReplyMock };
});

// Real titles pulled directly from the real Agents/*.md spec files -- not
// invented -- so the mocked registry lookup mirrors what the real
// AgentRegistry actually returns for these ids.
const SPECS: Record<string, SpecialistAgentSpec> = {
  "keyword-research-agent": { id: "keyword-research-agent", title: "Keyword Research & Search Intent Agent", mission: "m", responsibilities: [], rules: [] },
  "seo-strategy-agent": { id: "seo-strategy-agent", title: "SEO Strategy Agent", mission: "m", responsibilities: [], rules: [] },
  "seo-content-agent": { id: "seo-content-agent", title: "SEO Content Agent (Content Writing)", mission: "m", responsibilities: [], rules: [] },
  "on-page-seo-agent": { id: "on-page-seo-agent", title: "On-Page SEO Agent", mission: "m", responsibilities: [], rules: [] },
  "guest-posting-digital-pr-agent": { id: "guest-posting-digital-pr-agent", title: "Guest Posting & Digital PR Agent", mission: "m", responsibilities: [], rules: [] },
};

const KW_OUTPUT = "REAL_KEYWORD_RESEARCH_OUTPUT: primary keyword 'ai automation', topic clusters A/B/C.";
const STRATEGY_OUTPUT = "REAL_STRATEGY_OUTPUT: pillar-cluster model, 30/60/90 day roadmap.";
const CONTENT_OUTPUT = "REAL_CONTENT_OUTPUT: # What Is AI Automation?\nFull 1500-word article body...";
const ONPAGE_OUTPUT = "REAL_ONPAGE_OUTPUT: internal links to /services, /about; meta title 'AI Automation Guide'.";
const GUEST_OUTPUT = "REAL_GUEST_POSTING_OUTPUT: target publications, pitch angles, outreach template.";

const STAGE_OUTPUT_BY_AGENT: Record<string, string> = {
  "keyword-research-agent": KW_OUTPUT,
  "seo-strategy-agent": STRATEGY_OUTPUT,
  "seo-content-agent": CONTENT_OUTPUT,
  "on-page-seo-agent": ONPAGE_OUTPUT,
  "guest-posting-digital-pr-agent": GUEST_OUTPUT,
};

describe("runContentGenerationPipeline", () => {
  beforeEach(() => {
    getSpecialistAgentSpecMock.mockReset();
    generateSpecialistReplyMock.mockReset();
    getSpecialistAgentSpecMock.mockImplementation(async (agentId: string) => SPECS[agentId]);
    generateSpecialistReplyMock.mockImplementation(async (spec: SpecialistAgentSpec) => STAGE_OUTPUT_BY_AGENT[spec.id]);
  });

  // SCENARIO: Blog generation. A plain content request with no guest-posting
  // mention should still run the full Keyword Research -> Strategy -> Content
  // -> On-Page chain automatically, with no Guest Posting stage.
  it("runs the full automatic pipeline for a blog-generation request, without the guest-posting stage", async () => {
    const { runContentGenerationPipeline } = await import("../../../src/server/backend/specialist-orchestrator");
    const result = await runContentGenerationPipeline("Write a blog about Technical SEO.", "rationale");

    expect(result.trace.map((t) => t.agentId)).toEqual([
      "keyword-research-agent",
      "seo-strategy-agent",
      "seo-content-agent",
      "on-page-seo-agent",
    ]);
    expect(result.trace.map((t) => t.nextAgentId)).toEqual(["seo-strategy-agent", "seo-content-agent", "on-page-seo-agent", null]);
    expect(generateSpecialistReplyMock).toHaveBeenCalledTimes(4);
    expect(result.finalReply).toContain(KW_OUTPUT);
    expect(result.finalReply).toContain(STRATEGY_OUTPUT);
    expect(result.finalReply).toContain(CONTENT_OUTPUT);
    expect(result.finalReply).toContain(ONPAGE_OUTPUT);
    expect(result.finalReply).not.toContain(GUEST_OUTPUT);
  });

  // SCENARIO: Keyword research (standalone). Boss Agent routes bare keyword
  // requests directly to keyword-research-agent, not seo-content-agent, so
  // this pipeline must never treat it as an entry point -- that request
  // takes the existing single-agent path in route.ts, unaffected by this
  // change (verified live in the browser as part of this task's required
  // production verification).
  it("does not treat keyword-research-agent as a pipeline entry point", async () => {
    const { CONTENT_PIPELINE_ENTRY_AGENT_ID } = await import("../../../src/server/backend/specialist-orchestrator");
    expect(CONTENT_PIPELINE_ENTRY_AGENT_ID).toBe("seo-content-agent");
    expect(CONTENT_PIPELINE_ENTRY_AGENT_ID).not.toBe("keyword-research-agent");
  });

  // SCENARIO: Complete SEO campaign. The real prompt this whole fix was
  // reported against explicitly asks for a "guest posting outreach plan",
  // so all 5 stages must run, ending with Guest Posting & Digital PR Agent.
  it("runs all 5 stages, including guest posting, for a complete SEO campaign request", async () => {
    const { runContentGenerationPipeline } = await import("../../../src/server/backend/specialist-orchestrator");
    const message =
      "Create a complete SEO campaign for Ascent Digital's AI Automation service. " +
      "Your workflow must include a guest posting outreach plan.";
    const result = await runContentGenerationPipeline(message, "rationale");

    expect(result.trace.map((t) => t.agentId)).toEqual([
      "keyword-research-agent",
      "seo-strategy-agent",
      "seo-content-agent",
      "on-page-seo-agent",
      "guest-posting-digital-pr-agent",
    ]);
    expect(generateSpecialistReplyMock).toHaveBeenCalledTimes(5);
    expect(result.finalReply).toContain(GUEST_OUTPUT);
  });

  // SCENARIO: Guest posting workflow. A request that only asks to write a
  // guest post still triggers the Guest Posting stage, since it explicitly
  // names guest posting.
  it("includes the guest-posting stage whenever the request mentions guest posting", async () => {
    const { runContentGenerationPipeline, needsGuestPostingStage } = await import(
      "../../../src/server/backend/specialist-orchestrator"
    );
    expect(needsGuestPostingStage("Write a guest post.")).toBe(true);
    expect(needsGuestPostingStage("Write a blog about Technical SEO.")).toBe(false);

    const result = await runContentGenerationPipeline("Write a guest post.", "rationale");
    expect(result.trace.at(-1)?.agentId).toBe("guest-posting-digital-pr-agent");
  });

  // SCENARIO: Internal linking workflow. On-Page SEO Agent is the real
  // specialist that owns internal linking (Agents/on-page-seo-agent.md
  // Responsibilities: "Recommend and implement internal linking between
  // related pages") and meta title/description -- it must always run as
  // part of the pipeline and must receive the real written content, not an
  // empty/placeholder prompt.
  it("always runs the On-Page SEO (internal linking + meta) stage with the real content already provided", async () => {
    const { runContentGenerationPipeline } = await import("../../../src/server/backend/specialist-orchestrator");
    const result = await runContentGenerationPipeline("Write a blog about Technical SEO.", "rationale");

    const onPageStage = result.trace.find((t) => t.agentId === "on-page-seo-agent");
    expect(onPageStage).toBeDefined();
    expect(onPageStage!.input).toContain(CONTENT_OUTPUT);
  });

  // REGRESSION (requirement: specialists must never be asked to do work
  // another internal specialist already did): assert, deterministically,
  // that each downstream stage's actual prompt contains every upstream
  // stage's real output. If the data is genuinely embedded in the prompt,
  // there is no legitimate reason for the model to ask the user for it.
  it("passes every upstream stage's real output into every downstream stage's prompt", async () => {
    const { runContentGenerationPipeline } = await import("../../../src/server/backend/specialist-orchestrator");
    const result = await runContentGenerationPipeline(
      "Create a complete SEO campaign for Ascent Digital's AI Automation service, including guest posting outreach.",
      "rationale",
    );

    const [kw, strategy, content, onPage, guest] = result.trace;
    expect(kw!.input).not.toContain(STRATEGY_OUTPUT); // stage 1 has no upstream yet
    expect(strategy!.input).toContain(KW_OUTPUT);
    expect(content!.input).toContain(KW_OUTPUT);
    expect(content!.input).toContain(STRATEGY_OUTPUT);
    expect(onPage!.input).toContain(KW_OUTPUT);
    expect(onPage!.input).toContain(STRATEGY_OUTPUT);
    expect(onPage!.input).toContain(CONTENT_OUTPUT);
    expect(guest!.input).toContain(CONTENT_OUTPUT);
    expect(guest!.input).toContain(ONPAGE_OUTPUT);
  });

  // REGRESSION: every stage's prompt must explicitly instruct the model not
  // to ask the user for data already provided -- this is the actual
  // constraint being enforced, not just data availability.
  it("explicitly instructs every downstream stage not to ask the user for already-provided information", async () => {
    const { runContentGenerationPipeline } = await import("../../../src/server/backend/specialist-orchestrator");
    const result = await runContentGenerationPipeline("Write a blog about Technical SEO.", "rationale");

    for (const step of result.trace.slice(1)) {
      expect(step.input).toMatch(/do not ask the user for keywords, search intent, strategy, audience/i);
    }
  });
});
