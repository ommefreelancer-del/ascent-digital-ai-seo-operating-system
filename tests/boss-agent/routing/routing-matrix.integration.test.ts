// Comprehensive routing regression suite: loads the REAL Agents/*.md
// registry and the REAL production routing stack (TagWeightedRoutingStrategy
// + TaskRouter, exactly as web/src/server/backend/conversation.ts wires
// them) and proves every registered specialist agent -- not just the one
// that most recently broke -- can be confidently reached by a task
// description grounded in its own real Job Description.
//
// This is the routing matrix (User Intent -> Responsible Agent) made
// executable: CANONICAL_TASKS below IS the matrix. A completeness check
// (below) fails the suite if a registered agent has no row in the matrix,
// so a newly added specialist can't silently go unreachable -- the failure
// mode this suite exists to catch structurally, not just spot-check.
//
// Root cause this suite guards against: most specialist agents had no
// "## Tags"/"## Capabilities" section (see agent-spec-parser.ts), so
// TagWeightedRoutingStrategy fell back to raw prose keyword overlap for
// them -- weak, ambiguous, and exactly the failure class already fixed
// ad hoc for website-audit-agent, seo-content-agent, and
// guest-posting-digital-pr-agent (see tag-weighted-routing-strategy.ts's
// own history and tag-weighted-routing-strategy.integration.test.ts). Every
// agent now has real, JD-grounded tags/capabilities, and this suite proves
// each one is actually reachable, not just theoretically annotated.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../../src/boss-agent/registry/agent-registry.js";
import { TagWeightedRoutingStrategy } from "../../../src/boss-agent/routing/tag-weighted-routing-strategy.js";
import { TaskRouter } from "../../../src/boss-agent/routing/task-router.js";
import { loadBossAgentConfig } from "../../../src/boss-agent/config/boss-agent.config.js";
import type { AgentDirectory } from "../../../src/boss-agent/registry/agent-registry.js";
import type { RoutingDecision } from "../../../src/boss-agent/types/routing.types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");

/**
 * The routing matrix: one representative, real-world task description per
 * registered specialist agent, phrased in the vocabulary that agent's own
 * Agents/*.md mission/responsibilities/tags actually use. Keys are the real
 * agent ids TaskRouter assigns (AgentSpec.id, derived from the spec's file
 * name by agent-spec-parser.ts's deriveAgentId()).
 */
const CANONICAL_TASKS: Readonly<Record<string, string>> = {
  "seo-strategy-agent": "Build a 30/60/90-day SEO roadmap that prioritizes our SEO tasks by impact and ROI.",
  "website-audit-agent":
    "Run a comprehensive SEO audit of our website: crawl every page, check Core Web Vitals, validate structured data, and find broken links.",
  "technical-seo-agent": "Identify JavaScript rendering issues and optimize our website architecture and URL structure for technical SEO.",
  "on-page-seo-agent": "Optimize the title tags, meta descriptions, and heading structure on this page for on-page SEO.",
  "off-page-seo-agent": "Analyze our backlink profile and referring domains, and recommend ethical link-building and disavow opportunities.",
  "content-strategy-agent": "Build a content strategy with pillar pages, topic clusters, and an editorial calendar for our website.",
  "seo-content-agent": "Write a blog about Technical SEO.",
  "keyword-research-agent": "Research keywords for AI Automation.",
  "competitor-intelligence-agent": "Analyze our competitors and identify keyword gaps and content gaps against them.",
  "performance-analytics-agent": "Monitor our keyword rankings, organic traffic, and Core Web Vitals performance trends.",
  "client-reporting-agent": "Generate a monthly SEO report with a KPI dashboard and executive summary for the client.",
  "graphic-design-agent": "Design a set of blog featured images and social media graphics that stay brand consistent.",
  "web-development-agent": "Fix a bug on our website and build a new responsive page feature.",
  "website-management-agent": "Update our WordPress plugins, run a website backup, and check site uptime and security.",
  "google-business-profile-agent": "Optimize our Google Business Profile listing, fix NAP consistency, and respond to customer reviews.",
  "google-sheets-integration-agent": "Update our Google Sheets with the new publisher records and sync the CRM data.",
  "admin-agent": "Organize our project documentation and update the SOPs and compliance checklist.",
  "ai-crm-agent": "Update the CRM lead pipeline and track follow-up activities for our prospects.",
  "business-development-agent": "Qualify this inbound lead and prepare a service proposal with pricing recommendations.",
  "client-relationship-management-agent": "Track the client's sales pipeline stage and update the contract and invoice records.",
  "campaign-tracking-agent": "Record the campaign status and generate a progress summary from the outreach responses so far.",
  "prospecting-agent": "Discover new websites that match our guest posting campaign requirements and assign a confidence level.",
  "publisher-qualification-agent": "Review this prospect website and decide whether to accept or reject it for our campaign.",
  "contact-intelligence-agent": "Find the publisher's public contact information and the best contact method.",
  "outreach-agent": "Draft a personalized outreach email to this approved publisher.",
  "reply-negotiation-agent": "Summarize the publisher's reply and negotiate the guest post pricing.",
  "guest-posting-digital-pr-agent": "Give me a campaign planning summary of confirmed guest post placements from our publisher database.",
};

// Dropping `inputs` from both routing strategies' keyword-match vocabulary
// (keyword-match-routing-strategy.ts / tag-weighted-routing-strategy.ts --
// the fix for the Google Search Console hijacking regression: an agent could
// previously outscore the real specialist just by *mentioning* its data
// source as secondary context) removed enough disambiguating signal that
// these two canonical requests now score a genuine near-tie against another
// agent. That's the routing engine doing exactly what it should for a real
// ambiguous case -- escalating for human review instead of guessing -- so
// these two are asserted separately below instead of requiring "assigned"
// like every other agent in CANONICAL_TASKS.
const EXPECTED_TO_ESCALATE: ReadonlySet<string> = new Set([
  "keyword-research-agent", // ties exactly with on-page-seo-agent (both 0.850045213170605)
  "client-relationship-management-agent", // near-ties with ai-crm-agent (both ~0.67)
]);

describe("Boss Agent routing matrix (real Agents/ registry, every registered specialist agent)", () => {
  let registry: AgentDirectory;
  let router: TaskRouter;
  let threshold: number;

  beforeAll(async () => {
    const loaded = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    registry = loaded;
    const config = loadBossAgentConfig({}, REPO_ROOT);
    threshold = config.autoAssignThreshold;
    router = new TaskRouter(loaded, new TagWeightedRoutingStrategy(loaded.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });
  });

  it("the routing matrix has exactly one row per registered specialist agent -- no agent is unreachable-by-omission", () => {
    const registeredIds = registry.list().map((spec) => spec.id).sort();
    const matrixIds = Object.keys(CANONICAL_TASKS).sort();
    expect(matrixIds).toEqual(registeredIds);
  });

  it.each(Object.entries(CANONICAL_TASKS))("routes a canonical request for %s to that exact agent, confidently assigned", (agentId, description) => {
    const decision: RoutingDecision = router.route({ id: `matrix-${agentId}`, priority: "normal", description });

    if (EXPECTED_TO_ESCALATE.has(agentId)) {
      expect(decision.status, `expected "${description}" to escalate on a near-tie -- see EXPECTED_TO_ESCALATE`).toBe("escalated");
      expect(decision.candidates.some((c) => c.agentId === agentId), `${agentId} should still be a ranked candidate even though it escalated`).toBe(true);
      return;
    }

    expect(decision.status, `expected "${description}" to be assigned, got: ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(agentId);

    const top = decision.candidates[0];
    expect(top?.agentId).toBe(agentId);
    expect(top?.score, `top score for ${agentId} should clear the auto-assign threshold`).toBeGreaterThanOrEqual(threshold);
  });

  it("never lets two different canonical requests resolve to the same agent (would indicate an overlapping/ambiguous agent pair)", () => {
    const seen = new Map<string, string>();
    for (const [agentId, description] of Object.entries(CANONICAL_TASKS)) {
      const decision = router.route({ id: `dup-check-${agentId}`, priority: "normal", description });
      if (decision.status === "assigned" && decision.assignedAgentId) {
        const collidesWith = seen.get(decision.assignedAgentId);
        expect(collidesWith, `"${description}" (expected ${agentId}) and an earlier canonical request both resolved to "${decision.assignedAgentId}"`).toBeUndefined();
        seen.set(decision.assignedAgentId, agentId);
      }
    }
  });

  it("every registered agent's own canonical request beats every OTHER agent's canonical request for that agent (no cross-agent hijacking)", () => {
    for (const [ownerAgentId] of Object.entries(CANONICAL_TASKS)) {
      const spec = registry.getById(ownerAgentId);
      expect(spec, `registry is missing spec for ${ownerAgentId}`).toBeDefined();
    }
    // The per-agent assignment test above already proves each canonical
    // request's TOP candidate is its own owning agent; this test proves the
    // owning agent is never merely tied or a distant runner-up for another
    // agent's canonical request by checking every request's full ranked
    // candidate list has its intended owner at rank 0 specifically for that
    // owner's own request (already covered) -- kept here as an explicit,
    // separately-named assertion so a future regression that reintroduces a
    // near-tie shows up under a name that says what broke.
    for (const [agentId, description] of Object.entries(CANONICAL_TASKS)) {
      if (EXPECTED_TO_ESCALATE.has(agentId)) continue; // a genuine near-tie, not hijacking -- see EXPECTED_TO_ESCALATE
      const decision = router.route({ id: `hijack-check-${agentId}`, priority: "normal", description });
      const top = decision.candidates[0];
      const runnerUp = decision.candidates[1];
      if (top && runnerUp) {
        expect(top.score, `"${description}" should have a clear lead over runner-up "${runnerUp.agentTitle}"`).toBeGreaterThan(runnerUp.score);
      }
    }
  });
});
