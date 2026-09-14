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

// BROADENING (2026-09-20): a SECOND real, live-confirmed defect -- reproduced offline against this SAME
// real registry/router, NOT assumed. A request shaped exactly like the reported live failure ("Source:
// Health Master Sheet, Destination: Admin Sheet Health, protect existing destination records") scored as
// low as 0.22-0.39 under ordinary TagWeightedRoutingStrategy scoring -- well below the 0.50 auto-assign
// threshold -- because it named real sheet names ("Admin Sheet Health") rather than any of the OLD, narrower
// DOMAIN_PHRASES verbatim, and used "protect"/"proposal"/"validate" language the OLD ACTION_PHRASES didn't
// cover. See google-sheets-cleaning-intent-detector.ts's own header for the exact phrase-list broadening.
describe("Google Sheets cleaning routing fix -- broadened to recognize source/destination/protection/proposal/validation language (2026-09-20)", () => {
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

  it("6. REAL LIVE-FAILING REQUEST (reported): source/destination-shaped protection request now routes to google-sheets-integration-agent (previously escalated -- best match scored 0.22-0.39, below the 0.50 threshold)", () => {
    const decision = router.route({
      id: "gsc-6",
      priority: "normal",
      description:
        "Source: Health Master Sheet. Destination: Admin Sheet Health. Clean and process the source while protecting existing destination records, resolving duplicates, and preparing a proposal.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("7. A request naming real sheet names (never a hardcoded string this module recognizes) with 'source'/'merge' language, no other Sheets-domain phrase, still routes correctly", () => {
    const decision = router.route({
      id: "gsc-7",
      priority: "normal",
      description: "Process the source data and merge eligible new records into Admin Sheet Health while protecting existing priced records.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("8. Read-only validation language ('validate'/'read-only') combined with 'write destination' now routes correctly", () => {
    const decision = router.route({
      id: "gsc-8",
      priority: "normal",
      description: "Validate the configured write destination and prepare a read-only cleaning proposal for Health Master.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("9. Bare 'protect existing destination records and prepare the proposal' (no explicit sheet/spreadsheet name at all) still routes correctly -- previously escalated to an unrelated agent (Contact Intelligence Agent, scored 0.34)", () => {
    const decision = router.route({
      id: "gsc-9",
      priority: "normal",
      description: "Protect existing destination records and prepare the cleaning proposal.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("10. Merge/duplicate-resolution language between two named sheets still routes correctly", () => {
    const decision = router.route({
      id: "gsc-10",
      priority: "normal",
      description: "Resolve duplicates between Health Master and Admin Sheet Health, protect existing priced destination records, and produce a proposal.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("11. REGRESSION GUARD: the broadened 'destination'/'source' domain phrases still never fire without a real Sheets-cleaning action -- an ordinary multi-stage SEO request keeps orchestrating exactly as before", () => {
    const decision = router.route({ id: "gsc-11", priority: "normal", description: "Audit my website and find guest posting opportunities." });
    expect(decision.assignedAgentId).not.toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
    expect(decision.status).toBe("orchestrated");
  });

  it("12. REGRESSION GUARD: an explicit-name validation request for a DIFFERENT real agent is unaffected by the broadened 'validate' action phrase (no Sheets-domain phrase present)", () => {
    const decision = router.route({ id: "gsc-12", priority: "normal", description: "Validate the Website Audit Agent using real production evidence." });
    expect(decision.assignedAgentId).toBe("website-audit-agent");
    expect(decision.assignedAgentId).not.toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("13. REGRESSION GUARD: Human Approval Gate requests remain completely unaffected by the broadening", () => {
    const decision = router.route({ id: "gsc-13", priority: "normal", description: "Do we have any pending approvals right now?" });
    expect(decision.status).toBe("human_approval_gate");
    expect(decision.assignedAgentId).toBeUndefined();
  });
});
