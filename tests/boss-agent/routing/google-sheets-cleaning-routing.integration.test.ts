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

// REPORTED "LIVE FAILURE AFTER 5627618" INVESTIGATION (2026-09-20): a real, full-length, exact-shape
// reproduction of the user's own reported failing request. Offline reproduction against the CURRENT real
// src/boss-agent/routing/*.ts (this suite) shows it already routes correctly -- confirming the SOURCE code
// has no defect for this case. The actual reported live failure's real root cause is a STALE, un-rebuilt
// dist/ build: web/src/server/backend/conversation.ts (the live app's real entry point into routing) imports
// exclusively from dist/src/boss-agent/routing/*.js, never from src/*.ts directly, and dist/ (gitignored,
// never committed -- see .gitignore's own "dist/" entry) had not been regenerated since either routing fix
// landed: dist/src/boss-agent/routing/google-sheets-cleaning-intent-detector.js did not exist at all, and
// dist/src/boss-agent/routing/task-router.js was dated 2026-09-10, predating BOTH 2cd5226 (2026-09-17) and
// 5627618 (2026-09-20). No source-level test can catch or fix a stale build artifact -- this is a
// build/deploy gap ("run `npm run build`"), not a routing-code defect -- but this test locks in that the
// SOURCE itself is, and remains, correct for the exact reported request shape.
describe("REPORTED live failure after 5627618 -- offline reproduction against the real current source", () => {
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

  it("14. EXACT REPORTED REQUEST SHAPE: the full, exact-text request (source/destination/protection rules/cleaning rules/reporting requirements) routes to google-sheets-integration-agent", () => {
    const decision = router.route({
      id: "gsc-14",
      priority: "normal",
      description: `Use ONLY the google-sheets-integration-agent.

Create a NEW read-only cleaning proposal.

SOURCE:
Health Master Sheet

WRITE DESTINATION:
Admin Sheet Health

Important destination-protection rule:
Admin Sheet Health is the existing destination whose data must be preserved.

Before proposing any changes, read the existing Admin Sheet Health records and protect them.

If an incoming Health Master record matches an existing Admin Sheet Health record that already has a completed deal / admin price / client price information:
- keep the existing Admin Sheet Health record unchanged;
- do NOT delete it;
- do NOT overwrite it;
- do NOT replace it with the incoming record;
- omit the incoming duplicate from the write set.

If both the existing destination record and incoming record contain pricing/deal information, flag the case for manual review and do not automatically delete or overwrite either record.

Only ordinary unprotected duplicates may be removed according to the existing cleaning rules.

Apply the existing Health Master cleaning rules, including:
- remove exact duplicate rows;
- normalize valid URLs;
- flag uncertain domain/URL duplicates for manual review rather than automatically deleting them;
- preserve valid records;
- apply >=1,000 traffic to Admin and <1,000 traffic to Client;
- preserve the existing traffic formatting/normalization rules.

Generate the proposal and clearly report:
1. source;
2. write destination;
3. destination records protected;
4. incoming records omitted because they duplicate protected deal/price records;
5. records flagged for manual review;
6. exact duplicates removed;
7. Admin/Client split;
8. records proposed for writing.

READ-ONLY ONLY.
Do not write, delete, move, clear, overwrite, or modify any Google Sheet.
Do not modify Health Master Sheet.
Do not modify Admin Sheet Health.
Do not use paid APIs.
Do not change credentials or API keys.`,
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
    expect(decision.candidates[0]?.score).toBe(1);
  });

  it("15. REGRESSION GUARD: a genuine human-approval-status request (no Sheets-cleaning signal) still routes to 'human_approval_gate', unaffected by the exact-shape reproduction above", () => {
    const decision = router.route({
      id: "gsc-15",
      priority: "normal",
      description: "Please check the current status of any pending human approval gate items before I proceed with anything else.",
    });
    expect(decision.status).toBe("human_approval_gate");
    expect(decision.assignedAgentId).toBeUndefined();
  });
});

// GENERATED-OUTPUT CLEANUP ROUTING FIX (2026-09-21): a THIRD real, live-confirmed capability gap -- a
// request to clean ADASOS's own generated "Admin - Vendor" output tab by comparing its URLs against a
// separate, protected comparison sheet ("Admin Sheet Health") and removing duplicates only from
// "Admin - Vendor" scored as low as 0.21-0.35 under ordinary scoring (real registry/router, reproduced
// offline), escalating to Prospecting/Competitor Intelligence instead of google-sheets-integration-agent.
// See google-sheets-cleaning-intent-detector.ts's own header for why "Admin - Vendor" (ADASOS's own fixed,
// system-defined output-tab name) is safe to recognize by name here, unlike a user-chosen destination sheet.
describe("Google Sheets cleaning routing fix -- 'Admin - Vendor' generated-output cleanup against a protected comparison sheet (2026-09-21)", () => {
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

  it("16. REQUIRED CASE (reported): clean the generated 'Admin - Vendor' sheet by comparing URLs against the protected 'Admin Sheet Health' comparison sheet, removing duplicates only from 'Admin - Vendor', routes to google-sheets-integration-agent", () => {
    const decision = router.route({
      id: "gsc-16",
      priority: "normal",
      description:
        "Clean the Admin - Vendor sheet by comparing its URLs against the protected Admin Sheet Health comparison sheet, and remove duplicates only from Admin - Vendor. Do not touch Admin Sheet Health.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
    expect(decision.candidates[0]?.score).toBe(1);
  });

  it("17. Shorter phrasing variant: 'Compare Admin - Vendor against Admin Sheet Health and remove duplicate URLs, but only from Admin - Vendor.' routes correctly", () => {
    const decision = router.route({
      id: "gsc-17",
      priority: "normal",
      description: "Compare Admin - Vendor against Admin Sheet Health and remove duplicate URLs, but only from Admin - Vendor.",
    });
    expect(decision.status, `expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
    expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("18. Hyphenated/no-space naming variants ('Admin-Vendor', 'Admin Vendor') are both recognized", () => {
    for (const name of ["Admin-Vendor", "Admin Vendor"]) {
      const decision = router.route({
        id: `gsc-18-${name}`,
        priority: "normal",
        description: `Clean the ${name} sheet -- compare its URLs against the protected comparison sheet and remove duplicates only from ${name}.`,
      });
      expect(decision.status, `[${name}] expected "assigned", got: ${decision.status} -- ${decision.rationale}`).toBe("assigned");
      expect(decision.assignedAgentId).toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
    }
  });

  it("19. REGRESSION GUARD: the new 'compare' action phrase alone (no Sheets-cleaning domain signal) does not false-trigger on an unrelated competitive-analysis request", () => {
    const decision = router.route({ id: "gsc-19", priority: "normal", description: "Compare the SEO strategies of our top two competitors and summarize the differences." });
    expect(decision.assignedAgentId).not.toBe(GOOGLE_SHEETS_INTEGRATION_AGENT_ID);
  });

  it("20. REGRESSION GUARD: the new 'Admin - Vendor' domain phrase does not affect ordinary Human Approval Gate/orchestration routing when absent", () => {
    const decision = router.route({ id: "gsc-20", priority: "normal", description: "Do we have any pending approvals right now?" });
    expect(decision.status).toBe("human_approval_gate");
  });
});
