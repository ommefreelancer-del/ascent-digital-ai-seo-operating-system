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

import { getSpecialistAgentSpec } from "./conversation";
import { generateSpecialistReply, type SpecialistAgentSpec } from "./specialist-ai";

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
 * Every stage is a real generateSpecialistReply() call against that
 * specialist's own Agents/*.md spec -- nothing here is fabricated, and each
 * stage's real output is passed forward as real context to the next.
 */
export async function runContentGenerationPipeline(userMessage: string, routingRationale: string): Promise<ContentPipelineResult> {
  const trace: PipelineStepTrace[] = [];
  const upstream: Array<{ title: string; output: string }> = [];

  const kw = await runStage(
    1,
    KEYWORD_RESEARCH_AGENT_ID,
    userMessage,
    `${routingRationale} Automated content pipeline, stage 1: real keyword research for this request.`,
    upstream,
  );
  trace.push({ stage: 1, agentId: KEYWORD_RESEARCH_AGENT_ID, agentTitle: kw.spec.title, input: kw.input, output: kw.output, nextAgentId: SEO_STRATEGY_AGENT_ID });
  upstream.push({ title: kw.spec.title, output: kw.output });

  const strategy = await runStage(
    2,
    SEO_STRATEGY_AGENT_ID,
    userMessage,
    `${routingRationale} Automated content pipeline, stage 2: build the real SEO strategy using the keyword research above.`,
    upstream,
  );
  trace.push({ stage: 2, agentId: SEO_STRATEGY_AGENT_ID, agentTitle: strategy.spec.title, input: strategy.input, output: strategy.output, nextAgentId: CONTENT_PIPELINE_ENTRY_AGENT_ID });
  upstream.push({ title: strategy.spec.title, output: strategy.output });

  const content = await runStage(
    3,
    CONTENT_PIPELINE_ENTRY_AGENT_ID,
    userMessage,
    `${routingRationale} Automated content pipeline, stage 3: write the actual content using the real keyword research and strategy above.`,
    upstream,
  );
  const needsGuestPosting = needsGuestPostingStage(userMessage);
  trace.push({ stage: 3, agentId: CONTENT_PIPELINE_ENTRY_AGENT_ID, agentTitle: content.spec.title, input: content.input, output: content.output, nextAgentId: ON_PAGE_SEO_AGENT_ID });
  upstream.push({ title: content.spec.title, output: content.output });

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
    `## 1. Keyword Research (${kw.spec.title})`,
    kw.output,
    "",
    `## 2. SEO Strategy (${strategy.spec.title})`,
    strategy.output,
    "",
    `## 3. Content (${content.spec.title})`,
    content.output,
    "",
    `## 4. Internal Linking & Metadata (${onPage.spec.title})`,
    onPage.output,
  ];
  if (guestPosting) {
    sections.push("", `## 5. Guest Posting & Outreach (${guestPosting.spec.title})`, guestPosting.output);
  }

  return { finalReply: sections.join("\n"), trace };
}
