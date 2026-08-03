// Loads the REAL Agents/*.md files and the REAL TaskRouter to verify the
// concrete, testable form of the Phase 2 success criterion: "the Website
// Audit Agent should be confidently selected for comprehensive SEO audit
// requests." This is intentionally an integration test, not a unit test with
// a synthetic fixture -- it proves the actual annotated spec files route
// correctly, not just that the strategy's logic is sound in isolation.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentRegistry } from "../../../src/boss-agent/registry/agent-registry.js";
import { TagWeightedRoutingStrategy } from "../../../src/boss-agent/routing/tag-weighted-routing-strategy.js";
import { TaskRouter } from "../../../src/boss-agent/routing/task-router.js";
import { loadBossAgentConfig } from "../../../src/boss-agent/config/boss-agent.config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");

describe("TagWeightedRoutingStrategy (real Agents/ directory)", () => {
  it("confidently routes a comprehensive SEO audit request to website-audit-agent", async () => {
    const registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    const router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });

    const decision = router.route({
      id: "task-1",
      priority: "normal",
      description:
        "Run a comprehensive SEO audit of our website: crawl every page, check Core Web Vitals, validate structured data, and find broken links.",
    });

    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("website-audit-agent");

    const top = decision.candidates[0];
    expect(top?.agentId).toBe("website-audit-agent");
    expect(top?.score).toBeGreaterThanOrEqual(config.autoAssignThreshold);
  });

  it("still routes an unrelated, untagged task correctly (no regression from the tag signal)", async () => {
    const registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    const router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });

    const decision = router.route({
      id: "task-2",
      priority: "normal",
      description: "Write outreach emails to prospective guest-posting publishers and track replies.",
    });

    // Not asserting a specific agent (many outreach-adjacent agents could
    // plausibly match) -- only that routing didn't get hijacked toward
    // website-audit-agent by the new tag signal.
    if (decision.status === "assigned") {
      expect(decision.assignedAgentId).not.toBe("website-audit-agent");
    }
  });

  // REGRESSION: a real, live test against this exact prompt found
  // seo-content-agent wasn't even in the top 6 candidates (a 6-way tie at
  // 0.5 among agents that only share the generic words "technical"/"seo").
  // "blog" appears in exactly 1 of 27 specs' tags/capabilities -- the
  // IDF weighting (see tag-weighted-routing-strategy.ts) is what should now
  // let that one decisive, rare term outweigh several generic ones.
  it("routes a blog-writing request to seo-content-agent instead of losing it to generic technical/seo overlap", async () => {
    const registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    const router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });

    const decision = router.route({
      id: "task-3",
      priority: "normal",
      description: "Write a blog about Technical SEO.",
    });

    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("seo-content-agent");
  });

  it("keeps a keyword-research request confidently routed to keyword-research-agent", async () => {
    const registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    const router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });

    const decision = router.route({ id: "task-4", priority: "normal", description: "Research keywords for AI Automation." });

    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("keyword-research-agent");
  });

  it("keeps a guest-post request confidently routed to guest-posting-digital-pr-agent", async () => {
    const registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    const router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });

    const decision = router.route({ id: "task-5", priority: "normal", description: "Generate a guest post." });

    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("guest-posting-digital-pr-agent");
  });
});
