// GOOGLE SHEETS CLEANING ROUTING FIX (2026-09-17): real-registry, real-TaskRouter integration coverage.
// See src/boss-agent/routing/google-sheets-cleaning-intent-detector.ts's header for the real, live
// production defect this closes -- a request to clean "Health Master Sheet" using the configured Google
// Sheets Write Destination was routed to "human_approval_gate" instead of google-sheets-integration-agent,
// because human-approval-gate-intent-detector.ts's own generic phrase list ("pending approval", etc.) a
// genuine Google Sheets cleaning proposal naturally uses when describing its own human-approval-gated write
// step. This suite proves: (1) an explicit Google Sheets cleaning request now reaches
// google-sheets-integration-agent even when it also mentions approval/proposal/do-not-write language, (2)
// a genuine, Sheets-unrelated Human Approval Gate request still routes to "human_approval_gate" exactly as
// before -- the fix is a narrow carve-out, not a reordering of any other routing tier.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../../src/boss-agent/registry/agent-registry.js";
import { TagWeightedRoutingStrategy } from "../../../src/boss-agent/routing/tag-weighted-routing-strategy.js";
import { TaskRouter } from "../../../src/boss-agent/routing/task-router.js";
import { loadBossAgentConfig } from "../../../src/boss-agent/config/boss-agent.config.js";
import type { AgentDirectory } from "../../../src/boss-agent/registry/agent-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../..");
const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";

describe("Google Sheets cleaning routing fix -- real Agents/ registry, real TaskRouter", () => {
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

  it("1. REAL LIVE-FAILING REQUEST: cleaning Health Master Sheet with the configured write destination now routes to google-sheets-integration-agent (previously hijacked into human_approval_gate)", () => {
    const decision = router.route({
      id: "gsc-1",
      priority: "normal",
      description:
        "Clean and process Health Master Sheet using the configured Google Sheets Write Destination. Prepare the Google Sheets cleaning result -- nothing should be written until pending approval.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("2. REGRESSION GUARD: a genuine, Sheets-unrelated Human Approval Gate request still routes to 'human_approval_gate' exactly as before", () => {
    const decision = router.route({
      id: "gsc-2",
      priority: "normal",
      description: "PHASE 5 FINAL BLOCKER — HUMAN APPROVAL GATE. Run the final Phase 5 Human Approval Gate validation.",
    });
    expect(decision.status).toBe("human_approval_gate");
    expect(decision.assignedAgentId).toBeUndefined();
  });

  it("3. REGRESSION GUARD: 'pending approvals' phrasing alone (no Sheets-cleaning signal) still routes to 'human_approval_gate'", () => {
    const decision = router.route({ id: "gsc-3", priority: "normal", description: "Do we have any pending approvals right now?" });
    expect(decision.status).toBe("human_approval_gate");
  });

  it("4. A Google Sheets cleaning request containing 'approval'/'proposal'/'do not write' safety language still routes to google-sheets-integration-agent, not human_approval_gate", () => {
    const decision = router.route({
      id: "gsc-4",
      priority: "normal",
      description:
        "Inspect and clean the selected spreadsheet, produce a proposal, and do not write anything until I give explicit approval on the pending approval.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("5. A bare 'clean' request with no Google Sheets/spreadsheet domain signal is unaffected -- never force-assigned to google-sheets-integration-agent by the action word alone", () => {
    const decision = router.route({ id: "gsc-5", priority: "normal", description: "Clean up the duplicate content on my blog and fix the formatting." });
    expect(decision.assignedAgentId).not.toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });
});
