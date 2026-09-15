// Automatic multi-agent execution for content-generation requests. Boss
// Agent routing (../../boss-agent, untouched by this module) still makes
// exactly one RoutingDecision -- this only decides what happens once that
// decision has already assigned "seo-content-agent". Previously, that
// single assignment meant one LLM call role-playing only the SEO Content
// Agent, which then had to ask the user for keywords, strategy, audience,
// etc. -- data other ADASOS specialists already exist to produce. This
// module runs those specialists for real, in the order their own
// Agents/*.md specs describe (seo-content-agent.md "Communicates With:
// Receives: Content Strategy Agent, Keyword Research Agent, SEO Strategy
// Agent"; on-page-seo-agent.md "Receives: ... SEO Content Agent"), and
// feeds each stage's real output into the next stage's prompt as
// already-provided context, so no downstream specialist has a reason to
// ask the user for it.
//
// There is no separate "Internal Linking Agent" or "Meta Title/Description
// Agent" in the real Agents/ directory -- on-page-seo-agent.md's own
// Responsibilities cover both ("Recommend and implement internal linking
// between related pages" and "Optimize title tags and meta descriptions"),
// so that one real agent fills both roles in the requested workflow.
//
// KEYWORD RESEARCH -> CONTENT WIRING FIX (2026-08-21): stages 1 (Keyword
// Research) and 3 (SEO Content) no longer role-play those two specialists
// via generateSpecialistReply() -- they now dispatch to the real
// KeywordResearchAgent/ContentStrategyAgent/SeoContentAgent classes via
// content.ts's researchKeywordsAndGenerateContentFromMessage() (the SAME
// real agents/providers the dedicated /api/content form already uses).
// Keyword metrics come only from whatever KeywordDataProvider is actually
// configured for that agent -- honestly null if none is, never an LLM
// guess -- and the real structured keywordResearch/contentStrategy objects
// (not re-derived text) are what SEO Content Agent's real developContent()
// call consumes. Stages 2 (SEO Strategy), 4 (On-Page SEO), and 5 (Guest
// Posting) are separate specialists not implicated by this fix and remain
// real generateSpecialistReply() calls exactly as before.

import { getSpecialistAgentSpec } from "./conversation";
import { generateSpecialistReply, type SpecialistAgentSpec } from "./specialist-ai";
import { researchKeywordsAndGenerateContentFromMessage, summarizeKeywordResearchForChat, summarizeSeoContentForChat } from "./content";
import type { SeoContentResult } from "./types";

/** The only RoutingDecision.assignedAgentId that triggers this pipeline -- every other agent id is unaffected and still gets the single generateSpecialistReply() call it always has. */
export const CONTENT_PIPELINE_ENTRY_AGENT_ID = "seo-content-agent";

const KEYWORD_RESEARCH_AGENT_ID = "keyword-research-agent";
const SEO_STRATEGY_AGENT_ID = "seo-strategy-agent";
const ON_PAGE_SEO_AGENT_ID = "on-page-seo-agent";
const GUEST_POSTING_AGENT_ID = "guest-posting-digital-pr-agent";

// A deliberately narrow, word-boundary check -- consistent with this
// codebase's other deterministic intent signals (see
// boss-agent-meta-request-detector.ts and tag-weighted-routing-strategy.ts's
// content-authoring-intent check). This is an ORCHESTRATION decision made
// strictly after Boss Agent has already assigned seo-content-agent; it never
// feeds back into or changes the RoutingDecision itself.
const GUEST_POSTING_TRIGGER = /\b(guest[\s-]?post(?:ing)?|digital pr|outreach|backlink placement)\b/i;

/** True when the user's request explicitly asks for guest-posting/outreach work, in which case the Guest Posting & Digital PR Agent stage runs. Otherwise it's skipped -- per its own spec it operates on real publisher/outreach data ("Never fabricate publisher metrics"), which isn't relevant to a plain content request. */
export function needsGuestPostingStage(userMessage: string): boolean {
  return GUEST_POSTING_TRIGGER.test(userMessage);
}

export interface PipelineStepTrace {
  readonly stage: number;
  readonly agentId: string;
  readonly agentTitle: string;
  readonly input: string;
  readonly output: string;
  readonly nextAgentId: string | null;
}

export interface ContentPipelineResult {
  readonly finalReply: string;
  readonly trace: readonly PipelineStepTrace[];
  /**
   * STEP 6 PRODUCTION HARDENING (2026-08-21): the real, structured
   * SeoContentResult the pipeline's stage 3 (SEO Content) actually produced
   * -- exposed so the caller (api/workspace/messages/route.ts) can persist
   * it into the existing ContentDraft library, the same way the dedicated
   * /api/content form already does. Never a re-derived or fabricated
   * summary -- the exact same object researchKeywordsAndGenerateContentFromMessage()
   * returned.
   */
  readonly content: SeoContentResult;
}

async function requireSpec(agentId: string): Promise<SpecialistAgentSpec> {
  const spec = await getSpecialistAgentSpec(agentId);
  if (!spec) {
    throw new Error(`Content pipeline expected a real agent spec for "${agentId}", but the registry has none.`);
  }
  return spec;
}

/** Builds the extra prompt context that tells a downstream stage what upstream specialists already produced, so it never needs to ask the user for that information. */
function upstreamContext(upstream: ReadonlyArray<{ readonly title: string; readonly output: string }>): string {
  if (upstream.length === 0) return "";
  const provided = upstream.map((u) => `--- Real output already produced by the ${u.title} ---\n${u.output}`).join("\n\n");
  return (
    "\n\nThis is an automated ADASOS multi-agent pipeline. The upstream specialists below have ALREADY " +
    "produced real output for this exact request -- use it directly. Do not ask the user for keywords, " +
    "search intent, strategy, audience, or content that is already provided below. Only ask the user for " +
    "genuinely external information no ADASOS specialist can supply (API keys, client business specifics, " +
    "Google Search Console/Analytics access, publisher relationships, etc.).\n\n" +
    provided
  );
}

async function runStage(
  stageNumber: number,
  agentId: string,
  userMessage: string,
  rationale: string,
  upstream: ReadonlyArray<{ readonly title: string; readonly output: string }>,
): Promise<{ readonly spec: SpecialistAgentSpec; readonly input: string; readonly output: string }> {
  const spec = await requireSpec(agentId);
  console.log(`[content-pipeline] Stage ${stageNumber}: invoking ${spec.title} (${agentId}).`);
  const input = `${userMessage}${upstreamContext(upstream)}`;
  const output = await generateSpecialistReply(spec, input, rationale);
  console.log(`[content-pipeline] Stage ${stageNumber}: ${spec.title} produced ${output.length} chars.`);
  return { spec, input, output };
}

/**
 * Runs the real, automatic multi-agent content pipeline:
 * Keyword Research -> SEO Strategy -> SEO Content -> On-Page SEO (internal
 * linking + meta title/description) -> Guest Posting (only when the request
 * asks for it) -> a deterministic combined result.
 *
 * Stages 1 (Keyword Research) and 3 (SEO Content) dispatch to the real
 * KeywordResearchAgent/SeoContentAgent classes (see content.ts's
 * researchKeywordsAndGenerateContentFromMessage()) -- never LLM role-play.
 * Stages 2 (SEO Strategy), 4 (On-Page SEO), and 5 (Guest Posting) are real
 * generateSpecialistReply() calls against that specialist's own Agents/*.md
 * spec. Nothing here is fabricated, and each stage's real output is passed
 * forward as real context to the next.
 */
export async function runContentGenerationPipeline(userMessage: string, routingRationale: string): Promise<ContentPipelineResult> {
  const trace: PipelineStepTrace[] = [];
  const upstream: Array<{ title: string; output: string }> = [];

  // Stages 1 + 3: dispatch to the REAL Keyword Research Agent and the real
  // SEO Content Agent -- the same real agent classes/providers content.ts
  // already wires for the dedicated /api/content form (via the SAME cached
  // getAgents() instances) -- instead of an LLM role-playing either
  // specialist. Keyword metrics come only from whatever KeywordDataProvider
  // is actually configured for that agent (honestly null if none is,
  // never fabricated); the real, structured keywordResearch/contentStrategy
  // objects (not re-derived text) are what SEO Content Agent's real
  // developContent() call actually consumes.
  const kwSpec = await requireSpec(KEYWORD_RESEARCH_AGENT_ID);
  console.log(`[content-pipeline] Stage 1: invoking ${kwSpec.title} (${KEYWORD_RESEARCH_AGENT_ID}) via the real agent/provider, not LLM role-play.`);
  const contentSpec = await requireSpec(CONTENT_PIPELINE_ENTRY_AGENT_ID);
  const real = await researchKeywordsAndGenerateContentFromMessage(userMessage);
  console.log(
    `[content-pipeline] Stage 1: ${kwSpec.title} produced ${real.keywordResearch.classifiedKeywords.length} classified keyword(s), metricsAvailable=${real.keywordResearch.metricsAvailable}.`,
  );
  const kwOutput = summarizeKeywordResearchForChat(real.keywordResearch);
  trace.push({ stage: 1, agentId: KEYWORD_RESEARCH_AGENT_ID, agentTitle: kwSpec.title, input: userMessage, output: kwOutput, nextAgentId: SEO_STRATEGY_AGENT_ID });
  upstream.push({ title: kwSpec.title, output: kwOutput });

  const strategy = await runStage(
    2,
    SEO_STRATEGY_AGENT_ID,
    userMessage,
    `${routingRationale} Automated content pipeline, stage 2: build the real SEO strategy using the keyword research above.`,
    upstream,
  );
  trace.push({ stage: 2, agentId: SEO_STRATEGY_AGENT_ID, agentTitle: strategy.spec.title, input: strategy.input, output: strategy.output, nextAgentId: CONTENT_PIPELINE_ENTRY_AGENT_ID });
  upstream.push({ title: strategy.spec.title, output: strategy.output });

  console.log(
    `[content-pipeline] Stage 3: invoking ${contentSpec.title} (${CONTENT_PIPELINE_ENTRY_AGENT_ID}) via the real agent, not LLM role-play. Produced ${real.content.contentDrafts.length} draft(s), dataAvailable=${real.content.dataAvailable}.`,
  );
  const contentOutput = summarizeSeoContentForChat(real.content);
  const needsGuestPosting = needsGuestPostingStage(userMessage);
  trace.push({ stage: 3, agentId: CONTENT_PIPELINE_ENTRY_AGENT_ID, agentTitle: contentSpec.title, input: userMessage, output: contentOutput, nextAgentId: ON_PAGE_SEO_AGENT_ID });
  upstream.push({ title: contentSpec.title, output: contentOutput });

  const onPage = await runStage(
    4,
    ON_PAGE_SEO_AGENT_ID,
    userMessage,
    `${routingRationale} Automated content pipeline, stage 4: recommend internal linking and refine the meta title/description for the real content above.`,
    upstream,
  );
  trace.push({
    stage: 4,
    agentId: ON_PAGE_SEO_AGENT_ID,
    agentTitle: onPage.spec.title,
    input: onPage.input,
    output: onPage.output,
    nextAgentId: needsGuestPosting ? GUEST_POSTING_AGENT_ID : null,
  });
  upstream.push({ title: onPage.spec.title, output: onPage.output });

  let guestPosting: { readonly spec: SpecialistAgentSpec; readonly output: string } | null = null;
  if (needsGuestPosting) {
    const gp = await runStage(
      5,
      GUEST_POSTING_AGENT_ID,
      userMessage,
      `${routingRationale} Automated content pipeline, stage 5: guest posting / outreach plan for the real content and strategy above.`,
      upstream,
    );
    trace.push({ stage: 5, agentId: GUEST_POSTING_AGENT_ID, agentTitle: gp.spec.title, input: gp.input, output: gp.output, nextAgentId: null });
    guestPosting = gp;
  }

  const sections = [
    "# Automated ADASOS Content Generation Pipeline",
    "",
    "Boss Agent routed this request to the SEO Content Agent, which automatically ran the full internal " +
      "specialist pipeline below -- no intermediate keyword or strategy questions were needed.",
    "",
    `## 1. Keyword Research (${kwSpec.title})`,
    kwOutput,
    "",
    `## 2. SEO Strategy (${strategy.spec.title})`,
    strategy.output,
    "",
    `## 3. Content (${contentSpec.title})`,
    contentOutput,
    "",
    `## 4. Internal Linking & Metadata (${onPage.spec.title})`,
    onPage.output,
  ];
  if (guestPosting) {
    sections.push("", `## 5. Guest Posting & Outreach (${guestPosting.spec.title})`, guestPosting.output);
  }

  return { finalReply: sections.join("\n"), trace, content: real.content };
}
