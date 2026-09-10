// EXPLICIT-ROUTING PRIORITY FIX (2026-09-10): real-registry, real-TaskRouter
// integration coverage. See src/boss-agent/routing/task-router.ts's own
// "EXPLICIT-ROUTING PRIORITY FIX" comment for the real, reported production
// defect this closes -- a genuinely single-specialist, evidence-based
// operational request that BOTH explicitly names a real specialist ("route
// this to the On-Page SEO Agent") AND declares itself read-only/non-mutating
// ("do not modify the website", "do not create an approval change") was
// still swept into Boss's orchestrated audit -> remediation -> Keyword
// Research -> SEO Strategy -> SEO Content -> On-Page SEO content-generation
// pipeline, purely because the request's own wording combined enough bare
// stage-phrases ("seo audit" + "verify the results") to classify as an
// ORCHESTRATED intent ("end_to_end_seo") before the explicit agent name was
// ever consulted.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../../src/boss-agent/registry/agent-registry.js";
import { TagWeightedRoutingStrategy } from "../../../src/boss-agent/routing/tag-weighted-routing-strategy.js";
import { TaskRouter } from "../../../src/boss-agent/routing/task-router.js";
import { loadBossAgentConfig } from "../../../src/boss-agent/config/boss-agent.config.js";
import { classifyTaskIntent, isOrchestratedIntent } from "../../../src/boss-agent/routing/task-intent-classifier.js";
import type { AgentDirectory } from "../../../src/boss-agent/registry/agent-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");

const REAL_REPORTED_REQUEST =
  "Use the On-Page SEO Agent to perform an internal-linking audit for https://ommefreelancer-del.github.io/portfolio-website/ using the " +
  "existing saved SEO audit evidence. Retrieve the already-recorded list of the 17 pages identified as reachable through the sitemap but " +
  "having no internal links. Determine the exact URLs, identify the best existing source pages, and recommend contextual anchor text with " +
  "P1/P2/P3 priorities. Verify the results against the saved evidence only. Do not modify the website. Do not create an approval change.";

describe("Explicit single-agent routing takes priority over orchestration for a read-only request -- real Agents/ registry, real TaskRouter", () => {
  let registry: AgentDirectory;
  let router: TaskRouter;

  beforeAll(async () => {
    registry = await AgentRegistry.load(join(REPO_ROOT, "Agents"));
    const config = loadBossAgentConfig({}, REPO_ROOT);
    router = new TaskRouter(registry, new TagWeightedRoutingStrategy(registry.list()), {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });
  });

  it("REAL REPORTED CASE: without the fix, this exact request's own wording ('seo audit' + 'verify the results') classifies as an orchestrated intent on its own", () => {
    // Sanity check on the underlying phrase-combination this request
    // legitimately triggers -- proves the scenario below isn't vacuous: this
    // request really would have been orchestrated were it not read-only AND
    // explicitly named.
    const intent = classifyTaskIntent(REAL_REPORTED_REQUEST);
    expect(isOrchestratedIntent(intent ?? undefined)).toBe(true);
  });

  it("REAL REPORTED CASE: routes directly to on-page-seo-agent, not Boss's orchestrated content-generation pipeline", () => {
    const decision = router.route({ id: "explicit-ro-1", priority: "normal", description: REAL_REPORTED_REQUEST });
    expect(decision.status, `expected "assigned", got status "${decision.status}": ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe("on-page-seo-agent");
  });

  it("REGRESSION GUARD: the SAME request WITHOUT the read-only declaration still orchestrates, unaffected", () => {
    const withoutReadOnly = REAL_REPORTED_REQUEST.replace("Do not modify the website. Do not create an approval change.", "").trim();
    const decision = router.route({ id: "explicit-ro-2", priority: "normal", description: withoutReadOnly });
    expect(decision.status).toBe("orchestrated");
  });

  it("REGRESSION GUARD: a genuine multi-stage change request naming a specialist, but NOT read-only, still orchestrates (a single specialist can't remediate/deploy)", () => {
    const decision = router.route({
      id: "explicit-ro-3",
      priority: "normal",
      description: "Use the On-Page SEO Agent to audit https://example.com, fix every problem found, and deploy the fixes.",
    });
    expect(decision.status).toBe("orchestrated");
  });

  it("REGRESSION GUARD: the original canonical end-to-end client-production example (no explicit agent name) still classifies 'orchestrated', unaffected", () => {
    const decision = router.route({
      id: "explicit-ro-4",
      priority: "normal",
      description:
        "Audit this website, identify the SEO problems, create the strategy, fix every problem ADASOS can actually remediate, ask for " +
        "approval before production changes, execute the approved fixes, deploy them, verify the live results, and give me the final client report.",
    });
    expect(decision.status).toBe("orchestrated");
    expect(decision.taskIntent).toBe("end_to_end_seo");
  });

  it("REGRESSION GUARD: an explicit agent name with no read-only declaration and no orchestrated-intent signal still routes via the ORIGINAL explicit-match tier, unaffected", () => {
    const decision = router.route({ id: "explicit-ro-5", priority: "normal", description: "Use the On-Page SEO Agent to review our title tags." });
    expect(decision.status).toBe("assigned");
    expect(decision.assignedAgentId).toBe("on-page-seo-agent");
  });
});
