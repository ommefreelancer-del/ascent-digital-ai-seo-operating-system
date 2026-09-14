// Decides, for a single task, whether a specialist agent can be assigned
// automatically or whether the decision must go to a human. This is the
// "resolve conflicts between recommendations" and "escalate uncertainty
// instead of guessing" behavior required of the Boss Agent by BossAgent.md
// and GLOBAL_RULES.md SS1/SS2/SS13 — implemented as a routing *decision*
// only. No specialist agent is ever invoked here.
//
// CAPABILITY GATING (production hardening, see capability-classifier.ts):
// before any candidate is scored, this now derives which real capability
// classes the task requires and — for the two classes the current 27-agent
// roster has a genuine coverage gap for, "technical-implementation" and
// "orchestration" — HARD-EXCLUDES any candidate that lacks it. This is a
// filter applied before scoring, not a score penalty: keyword/tag overlap
// can no longer rescue a candidate that structurally lacks a required
// capability the way it previously could (a real, live-tested failure: a
// technical+orchestration task was repeatedly routed to Keyword Research,
// SEO Strategy, SEO Content, and On-Page SEO in turn, all four rejecting it
// for lacking the required tools, because nothing before this gated on
// capability at all — TagWeightedRoutingStrategy's own
// hasContentAuthoringIntent override was even forcing SEO Content Agent's
// score to 1.00 from surface terms like "write"/"content" alone). When
// gating leaves zero eligible candidates, route() stops immediately with a
// dedicated "capability_unavailable" escalation instead of guessing among
// disqualified specialists.
//
// NO-RE-ROUTING STATE: the optional RoutingRejectionTracker makes a
// "capability unavailable" outcome authoritative for later route() calls on
// the SAME task id -- a second call is answered from that recorded state
// immediately, without re-scoring, so the same task can never be walked
// through the same disqualified capability class more than once.
//
// BOSS AS THE EXPLICIT ORCHESTRATION AUTHORITY (2026-08-13): a genuine
// architectural gap in the capability-gating fix above is that "orchestration
// capability is required" always resolved to capability_unavailable, since
// isCandidateEligibleFor("orchestration", ...) is unconditionally false for
// every SPECIALIST candidate -- correct in isolation (no specialist has Boss
// routing-engine access), but wrong as a final answer: ADASOS has no separate
// "Orchestration Agent" by design (see Agents/BossAgent.md) -- the Boss
// Agent making this very routing decision IS the orchestration authority.
// "capability_unavailable" is the right outcome for a genuine gap (nobody
// can do this); it is the WRONG outcome for orchestration specifically,
// which always has a real, capable owner: Boss itself. When `bossAgentSpec`
// is provided (Boss's own real, parsed Agents/BossAgent.md content -- see
// registry/agent-registry.ts's getBossAgentSpec(), never fabricated) and a
// task requires orchestration, route() now returns "boss_retained" instead:
// Boss keeps the task rather than delegating it to an ineligible specialist
// OR reporting a capability gap that doesn't actually exist. If
// `bossAgentSpec` is omitted (an older/lighter caller), the router falls
// back to the honest capability_unavailable outcome rather than fabricating
// Boss's authority without its real spec confirming it.

import type { AgentDirectory } from "../registry/agent-registry.js";
import type { RoutingDecision } from "../types/routing.types.js";
import type { TaskInput } from "../types/task.types.js";
import type { RoutingStrategy } from "./routing-strategy.js";
import { GATING_CAPABILITIES, extractRequiredCapabilities, isCandidateEligibleFor, type CapabilityClass } from "./capability-classifier.js";
import { RoutingRejectionTracker } from "./routing-rejection-tracker.js";
import type { AgentSpec } from "../types/agent-spec.types.js";
import { classifyTaskIntent, isOrchestratedIntent, isReadOnlyRequest, type TaskIntent } from "./task-intent-classifier.js";
import { isProspectingIntent } from "./prospecting-intent-detector.js";
import { isCampaignTrackingIntent } from "./campaign-tracking-intent-detector.js";
import { isHumanApprovalGateIntent } from "./human-approval-gate-intent-detector.js";
import { isGoogleSheetsCleaningIntent } from "./google-sheets-cleaning-intent-detector.js";
import { isSystemVerificationIntent } from "./system-verification-intent-detector.js";
import { findExplicitAgentMatch, findUnresolvedAgentMention } from "./explicit-agent-match.js";

const ORCHESTRATION_CAPABILITY: CapabilityClass = "orchestration";
/** Grounded in registry/agent-spec-parser.ts's deriveAgentId() -- "prospecting-agent" from Agents/prospecting-agent.md's own filename, matching src/agents/prospecting-agent/dispatch.ts's PROSPECTING_AGENT_ID. Mirrors capability-classifier.ts's own established precedent of hardcoding a literal, grounded agent id here rather than importing a specific specialist agent's module into boss-agent code. */
const PROSPECTING_AGENT_ID = "prospecting-agent";
/** Grounded in registry/agent-spec-parser.ts's deriveAgentId() -- "campaign-tracking-agent" from Agents/campaign-tracking-agent.md's own filename, matching src/agents/campaign-tracking-agent/dispatch.ts's CAMPAIGN_TRACKING_AGENT_ID. */
const CAMPAIGN_TRACKING_AGENT_ID = "campaign-tracking-agent";
/** Grounded in registry/agent-spec-parser.ts's deriveAgentId() -- "google-sheets-integration-agent" from Agents/google-sheets-integration-agent.md's own filename, matching web/src/app/api/workspace/messages/route.ts's own GOOGLE_SHEETS_INTEGRATION_AGENT_ID constant. */
const GOOGLE_SHEETS_INTEGRATION_AGENT_ID = "google-sheets-integration-agent";

export interface TaskRouterConfig {
  /** Minimum score (0-1) a top candidate must reach to be auto-assigned. */
  readonly autoAssignThreshold: number;
  /** Minimum lead (0-1) the top candidate must hold over the runner-up to avoid a tie escalation. */
  readonly tieMargin: number;
  /** How many ranked candidates to keep on the decision for human review / audit. */
  readonly maxCandidates: number;
}

const CAPABILITY_UNAVAILABLE_RATIONALE = "Correct capability identified, but required tool/access capability is unavailable.";

export class TaskRouter {
  constructor(
    private readonly registry: AgentDirectory,
    private readonly strategy: RoutingStrategy,
    private readonly config: TaskRouterConfig,
    private readonly rejectionTracker: RoutingRejectionTracker = new RoutingRejectionTracker(),
    /**
     * Boss Agent's own real, parsed spec (Agents/BossAgent.md via
     * registry.getBossAgentSpec()). When provided, a task requiring
     * orchestration resolves to "boss_retained" instead of
     * "capability_unavailable" -- see this file's own header comment.
     * Omit only for callers that haven't wired it through yet; the router
     * degrades to the honest capability-gap outcome rather than fabricating
     * Boss's authority.
     */
    private readonly bossAgentSpec?: AgentSpec,
  ) {}

  route(task: TaskInput): RoutingDecision {
    const decidedAt = new Date().toISOString();

    // Rule 3/5: a task already found to require an unavailable capability
    // stays refused -- never re-scored, never walked into a different
    // disqualified candidate on a later call for the same task id.
    if (this.rejectionTracker.hasUnresolvedRejection(task.id)) {
      return this.capabilityUnavailableDecision(task, [], decidedAt);
    }

    // PRODUCTION ROUTING FIX (2026-08-15): classified BEFORE specialist
    // gating/scoring and before the orchestration-capability (meta-request)
    // check below -- see task-intent-classifier.ts's own header for the
    // real production defect this fixes (a genuine multi-stage client
    // request scoring low against every individual specialist and being
    // silently auto-resolved to the closest one). `taskIntent` is attached
    // to EVERY decision this method returns from here on, regardless of
    // status, so the original client objective survives every downstream
    // handoff -- only an ORCHESTRATED intent changes the routing OUTCOME
    // (short-circuits straight to Boss ownership, below); audit_only/
    // advisory_only are recorded for observability/downstream continuation
    // decisions but still go through ordinary specialist scoring exactly as
    // before, so a simple "Audit my website." still reaches Website Audit
    // Agent the same way it always has.
    const taskIntent = classifyTaskIntent(task.description) ?? undefined;

    // HUMAN APPROVAL GATE ROUTING FIX (2026-08-19): checked BEFORE the
    // orchestrated-intent short-circuit below -- see
    // human-approval-gate-intent-detector.ts's own header for the real
    // production defect this closes (an explicit request to inspect/test
    // the Human Approval Gate was classified "end_to_end_seo" by
    // task-intent-classifier.ts and short-circuited into a full,
    // audit-first pipeline, since the gate's real logic in
    // web/src/server/backend/remediation.ts is only ever reachable today as
    // a middle stage of that fixed sequence). This tier is deliberately
    // narrow (see the detector's own phrase list) so a genuine multi-stage
    // client request that merely mentions "approval" as one of several
    // stages -- the ORIGINAL production-routing-fix example this file's
    // header documents -- keeps classifying "end_to_end_seo"/"orchestrated"
    // exactly as before, unaffected.
    //
    // GOOGLE SHEETS CLEANING ROUTING FIX (2026-09-17): a real, live-confirmed
    // defect -- HUMAN_APPROVAL_GATE_PHRASES includes generic phrases
    // ("pending approval", "pending approvals") that a genuine Google Sheets
    // cleaning proposal naturally uses when describing its own
    // human-approval-gated write step, so a request to "clean Health Master
    // Sheet using the configured ... destination" was hijacked into
    // "human_approval_gate" before ever reaching specialist routing. Human
    // approval is a LATER workflow state for the cleaning result, never the
    // specialist responsible for producing it. See
    // google-sheets-cleaning-intent-detector.ts's own header -- narrow
    // enough that a genuine "check my pending approvals" request with no
    // Sheets-cleaning signal at all is completely unaffected.
    if (isHumanApprovalGateIntent(task.description) && !isGoogleSheetsCleaningIntent(task.description)) {
      return {
        taskId: task.id,
        status: "human_approval_gate",
        taskIntent,
        candidates: [],
        rationale:
          "This request explicitly names the Human Approval Gate -- routed directly to the real, workspace-scoped " +
          "pending-approval state (web/src/server/backend/remediation.ts) instead of the full audit-first " +
          "orchestrated pipeline, which the gate would otherwise only be reachable through as a middle stage.",
        decidedAt,
      };
    }

    // PRODUCTION-READINESS VERIFICATION ROUTING FIX (2026-08-19): checked
    // BEFORE the orchestrated-intent short-circuit below (same tier as the
    // Human Approval Gate check above, and for the same reason) -- see
    // system-verification-intent-detector.ts's own header for the real
    // production defect this closes (a request to verify the SYSTEM itself
    // -- agent routing, tool/resource availability, the Phase 5 gate's own
    // configuration, tenant isolation, or overall production readiness --
    // was classified as an SEO/remediation workflow by
    // classifyTaskIntent()'s bare-word stage matching and routed into a
    // live SEO audit, purely because a verification request naturally
    // describes SEO-adjacent concepts like "remediation" or "approval" as
    // part of WHAT it verifies). Reuses the existing "boss_retained" status
    // -- see its own doc comment in types/routing.types.ts, which already,
    // precisely covers this: only Boss Agent has genuine access to its own
    // routing/registry/capability-gating/approval-state internals, no
    // specialist agent does. Guarded on `this.bossAgentSpec` for the same
    // reason every other boss_retained return in this file is -- never
    // fabricate Boss's authority without its real spec confirming it.
    if (isSystemVerificationIntent(task.description) && this.bossAgentSpec) {
      return {
        taskId: task.id,
        status: "boss_retained",
        taskIntent,
        candidates: [],
        rationale:
          "This request explicitly asks to verify the system itself (agent routing, tool/resource availability, " +
          "gate configuration, tenant isolation, or production readiness) -- the Boss Agent's own orchestration " +
          "authority (task classification, routing, capability-registry inspection, tool/access gating, " +
          "execution/rejection-state control) is the only real access point for this, so it is never routed to " +
          "an SEO/remediation specialist or workflow.",
        decidedAt,
      };
    }

    // EXPLICIT-ROUTING PRIORITY FIX (2026-09-10): a real, live-reproduced
    // defect -- a genuinely single-specialist, evidence-based operational
    // request ("Retrieve the already-recorded list of the 17 pages...
    // recommend contextual anchor text... provide P1/P2/P3 priorities...")
    // that BOTH explicitly names a real specialist ("route this to the
    // On-Page SEO Agent") AND declares itself non-mutating ("do not modify
    // the website, do not create an approval change") still got swept into
    // the orchestrated-intent short-circuit below purely because its own
    // wording happened to combine enough bare stage-phrases (e.g. "audit",
    // "priorities") to classify as an ORCHESTRATED intent -- forcing it
    // through Boss's full audit -> remediation -> Keyword Research -> SEO
    // Strategy -> SEO Content -> On-Page SEO content-generation pipeline
    // instead of the single, explicitly-named specialist the user actually
    // asked for. That pipeline (a) has no access to this task's own saved
    // audit evidence at the point it's invoked with a raw chat message, (b)
    // always runs a real Keyword Research stage (a real DataForSEO call)
    // the task never needed, and (c) produces a content-authoring
    // deliverable, not an operational audit.
    //
    // The fix is narrow and additive, never touching ordinary orchestration:
    // an explicit, UNAMBIGUOUS single-agent match (findExplicitAgentMatch --
    // same real tier-0 gate used below, just computed once and reused) is
    // trusted to take priority over the orchestrated-intent classification
    // ONLY when the task also explicitly declares itself read-only
    // (isReadOnlyRequest() -- the same real READ_ONLY_PHRASES mechanism
    // already used to keep a declared-read-only audit request out of
    // "audit_and_remediate"). A read-only request can never actually need
    // Boss's own remediate/execute/deploy orchestration BY DEFINITION, so
    // this can never divert a genuine multi-stage change request (which is
    // never simultaneously read-only) away from Boss ownership -- every
    // existing orchestrated-intent test/scenario that isn't ALSO explicitly
    // read-only is completely unaffected.
    const explicitMatch = findExplicitAgentMatch(task.description, this.registry);
    if (explicitMatch && isReadOnlyRequest(task.description)) {
      const spec = this.registry.getById(explicitMatch.agentId)!;
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: explicitMatch.agentId,
        taskIntent,
        candidates: [{ agentId: spec.id, agentTitle: spec.title, score: 1, matchedTerms: [] }],
        rationale:
          `The request explicitly names "${explicitMatch.matchedPhrase.trim()} Agent" and declares itself ` +
          `read-only/non-mutating -- resolved directly to "${spec.title}" instead of Boss's orchestrated ` +
          "pipeline, since a read-only request can never need remediation/execution/deployment orchestration.",
        decidedAt,
      };
    }

    if (taskIntent && isOrchestratedIntent(taskIntent)) {
      return {
        taskId: task.id,
        status: "orchestrated",
        taskIntent,
        candidates: [],
        rationale:
          `This request spans multiple SEO-workflow stages (classified as "${taskIntent}") -- audit, strategy, ` +
          "remediation, approval, execution, deployment, and/or verification. A request requiring this kind of " +
          "combination is never a task for a single specialist agent to partially handle; the Boss Agent owns it " +
          "end-to-end, dispatching to specialists as needed and resuming control after each real result.",
        decidedAt,
      };
    }

    // EXPLICIT AGENT NAME MATCH (2026-08-16, broker/router root-cause pass):
    // see explicit-agent-match.ts's own header for the real production
    // defect this closes -- a real, live 27-agent validation round found
    // website-audit-agent's exceptionally broad spec systematically
    // outscoring an EXPLICITLY NAMED narrower specialist under ordinary
    // keyword/tag overlap scoring (confirmed: "Validate the On-Page SEO
    // Agent..." scored website-audit-agent 0.723 with on-page-seo-agent not
    // even in the top 3; even "Validate the Technical SEO Agent..." lost to
    // website-audit-agent, 0.727 vs 0.440). Checked here -- after the
    // multi-stage orchestration check (so a genuinely multi-stage request
    // still goes to Boss first) and before every other gate/score below --
    // so a message that clearly, unambiguously names one real specialist
    // resolves to it directly, never fighting a broader agent's raw term
    // coverage. Only ever resolves to a real, currently-loaded registry id
    // (see findExplicitAgentMatch's own grounding); returns `null` (falls
    // through to ordinary capability gating/scoring, completely unchanged)
    // for any message that names no agent, or names two genuinely different
    // agents ambiguously. Reuses the SAME explicitMatch computed above (the
    // EXPLICIT-ROUTING PRIORITY FIX tier) rather than recomputing it -- that
    // tier only returns early when the request is ALSO read-only; a
    // non-read-only explicit match still falls through to here, unchanged.
    if (explicitMatch) {
      const spec = this.registry.getById(explicitMatch.agentId)!;
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: explicitMatch.agentId,
        taskIntent,
        candidates: [{ agentId: spec.id, agentTitle: spec.title, score: 1, matchedTerms: [] }],
        rationale: `The request explicitly names "${explicitMatch.matchedPhrase.trim()} Agent" -- resolved directly to "${spec.title}" before generic specialist scoring.`,
        decidedAt,
      };
    }

    // HONEST "AGENT DOESN'T EXIST" REPORTING (STRICT PRODUCTION REPAIR,
    // 2026-08-17): see explicit-agent-match.ts's own findUnresolvedAgentMention()
    // header for the real registry cross-check this closes -- several
    // Title-Case "<Name> Agent" mentions (e.g. "International SEO Agent",
    // "AI Prompt Engineering Agent", "Automation Workflow Agent", "Voice
    // Interface Agent", "Programmatic SEO Agent", "E-commerce SEO Agent")
    // name no real, registered specialist and have no disclosed alias.
    // Checked here -- immediately after the explicit-match tier above finds
    // nothing -- so a genuinely missing agent is escalated honestly instead
    // of falling through to ordinary capability/tag-weighted scoring, where
    // website-audit-agent's broad spec would otherwise silently hijack it
    // (the same keyword-overlap defect explicit-agent-match.ts's tier-0 gate
    // already stops for REAL agents, but scoring alone can never catch for
    // an agent that was never real to begin with).
    const unresolvedMention = findUnresolvedAgentMention(task.description, this.registry, this.bossAgentSpec?.title);
    if (unresolvedMention) {
      return {
        taskId: task.id,
        status: "escalated",
        taskIntent,
        candidates: [],
        rationale:
          `The request explicitly names "${unresolvedMention.matchedPhrase} Agent", but no agent with that name ` +
          "(and no disclosed alias to one) exists in the real, registered specialist roster. Rather than silently " +
          "routing this to a differently-named agent via keyword/tag overlap, this is reported honestly: the " +
          "requested agent does not exist in ADASOS's current registry.",
        decidedAt,
        escalationReason: "requested_agent_not_found",
      };
    }

    // GOOGLE SHEETS CLEANING ROUTING FIX (2026-09-17, repositioned 2026-09-20): checked here -- AFTER both
    // explicit-agent-name-match tiers above, same tier cluster as prospecting/campaign-tracking below --
    // NOT immediately after the Human Approval Gate carve-out anymore. A real regression was found at this
    // file's original (earlier) position: "Validate the Google Sheets Integration Agent using real
    // production evidence." (the SAME self-referential validation phrasing every other agent's own explicit-
    // match test uses) ALSO matches this detector's domain+action phrases ("Google Sheets" + "validate"), so
    // positioning this tier before the explicit-name-match tiers let it steal a message that should resolve
    // via the MORE PRECISE explicit-agent-name mechanism (with its own, more specific rationale) instead.
    // Positioned here, an explicit "<Agent Name> Agent" mention (including this agent's own name) is always
    // resolved by the explicit-match tiers first; this tier only ever fires for a genuine Sheets-cleaning
    // request that does NOT explicitly name an agent by title. The orchestrated-intent check at line ~296
    // above already runs before this point for every message, so (unlike the original position) this tier
    // no longer needs its own separate mixed-stage-guard -- a message classified orchestrated already
    // returned "orchestrated" before ever reaching here. A genuine Google Sheets cleaning request must still
    // deterministically reach google-sheets-integration-agent: ordinary TagWeightedRoutingStrategy scoring
    // was empirically confirmed (real registry, real strategy) to score this agent as low as 0.22-0.39 for a
    // real cleaning-proposal-shaped message -- well below the auto-assign threshold -- because generic
    // approval/proposal/protection/destination language dilutes keyword/tag overlap against this agent's
    // narrower spec, the same class of problem prospecting/campaign-tracking's own deterministic gates below
    // already solve for their own domains.
    const hasGoogleSheetsCleaningIntent = isGoogleSheetsCleaningIntent(task.description);
    const googleSheetsIntegrationSpec = hasGoogleSheetsCleaningIntent ? this.registry.getById(GOOGLE_SHEETS_INTEGRATION_AGENT_ID) : undefined;
    if (hasGoogleSheetsCleaningIntent && googleSheetsIntegrationSpec) {
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: GOOGLE_SHEETS_INTEGRATION_AGENT_ID,
        taskIntent,
        candidates: [{ agentId: googleSheetsIntegrationSpec.id, agentTitle: googleSheetsIntegrationSpec.title, score: 1, matchedTerms: [] }],
        rationale:
          "This request clearly asks to clean/process a Google Sheet (source, write destination, and/or the " +
          "cleaning result itself) -- a deterministic capability gate assigned it directly to the Google Sheets " +
          "Integration Agent before generic specialist scoring, regardless of any approval/proposal/do-not-write " +
          "safety language also present -- human approval is a later workflow state for the result, never the " +
          "specialist responsible for producing it.",
        decidedAt,
      };
    }

    // PROSPECTING ROUTING FIX (2026-08-16): see prospecting-intent-detector.ts's
    // own header for the real production defect this closes -- a clearly
    // stated guest-posting/prospect-discovery request must reach Prospecting
    // Agent deterministically, BEFORE generic specialist scoring, the same
    // way orchestration-authority and multi-stage requests already bypass
    // scoring above. Checked here (after the orchestrated-intent
    // short-circuit, before capability gating/scoring) so a genuinely
    // multi-stage SEO-workflow request keeps going to Boss ownership first.
    const hasProspectingIntent = isProspectingIntent(task.description);

    // MIXED-STAGE GUARD: when the SAME message ALSO carries a (non-orchestrated)
    // SEO-workflow stage signal -- `taskIntent` is set to "audit_only" or
    // "advisory_only" via classifyTaskIntent() above, e.g. "Audit my website
    // and find guest posting opportunities" -- this spans two genuinely
    // different specialist domains that no single specialist (Prospecting OR
    // Website Audit) fully owns. Reuses the exact same "orchestrated" outcome
    // shape the multi-SEO-workflow-stage check above already returns, rather
    // than silently assigning to just one half of the request.
    if (hasProspectingIntent && taskIntent) {
      return {
        taskId: task.id,
        status: "orchestrated",
        taskIntent,
        candidates: [],
        rationale:
          `This request combines a guest-posting/prospect-discovery ask with another SEO-workflow stage ` +
          `(classified as "${taskIntent}") -- no single specialist owns both; the Boss Agent owns it end-to-end, ` +
          "dispatching to Prospecting and the relevant specialist as needed.",
        decidedAt,
      };
    }

    // Guarded on registry membership (rather than assuming the id) so a
    // registry that genuinely excludes prospecting-agent (e.g. a scoped
    // test registry) falls through to ordinary capability gating/scoring
    // instead of forcing an "assigned" decision ComplianceValidator would
    // reject (an id not present in the loaded registry).
    const prospectingSpec = hasProspectingIntent ? this.registry.getById(PROSPECTING_AGENT_ID) : undefined;
    if (hasProspectingIntent && prospectingSpec) {
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: PROSPECTING_AGENT_ID,
        taskIntent,
        // A real candidate entry (score 1 -- certain, not a fabricated
        // ratio) rather than an empty list, so this "assigned" decision's
        // shape matches every ordinarily-scored "assigned" decision for any
        // downstream consumer that reads candidates[0] (e.g. the routing
        // matrix regression suite).
        candidates: [{ agentId: prospectingSpec.id, agentTitle: prospectingSpec.title, score: 1, matchedTerms: [] }],
        rationale:
          "This request clearly asks for guest-posting/publisher prospect discovery -- a deterministic capability " +
          "gate assigned it directly to the Prospecting Agent (real, live DataForSEO-backed search + page-evidence " +
          "discovery) before generic specialist scoring.",
        decidedAt,
      };
    }

    // CAMPAIGN TRACKING ROUTING FIX (2026-08-18): see
    // campaign-tracking-intent-detector.ts's own header for the real, live
    // production defect this closes -- a clearly-stated request to track/
    // update the status of one SPECIFIC, NAMED campaign (e.g. "Please
    // update the campaign called Autumn Link Building with progress
    // notes.") scored below the auto-assign threshold under ordinary
    // scoring, because the campaign's own free-text name dilutes the
    // keyword/tag overlap ratio. Checked here (same tier as prospecting's
    // own deterministic gate, after it so an existing discovery-intent
    // classification is never overridden) so this reaches Campaign
    // Tracking Agent's real create/save/read/verify persistence pipeline
    // deterministically instead of being silently rejected.
    const hasCampaignTrackingIntent = isCampaignTrackingIntent(task.description);

    // MIXED-STAGE GUARD: mirrors the prospecting gate's own guard above --
    // a message that ALSO carries a non-orchestrated SEO-workflow stage
    // signal spans two genuinely different specialist domains; Boss owns it
    // end-to-end rather than silently assigning just the campaign-tracking
    // half.
    if (hasCampaignTrackingIntent && taskIntent) {
      return {
        taskId: task.id,
        status: "orchestrated",
        taskIntent,
        candidates: [],
        rationale:
          `This request combines a specific-campaign status/progress check with another SEO-workflow stage ` +
          `(classified as "${taskIntent}") -- no single specialist owns both; the Boss Agent owns it end-to-end, ` +
          "dispatching to Campaign Tracking and the relevant specialist as needed.",
        decidedAt,
      };
    }

    // Guarded on registry membership -- see the identical comment on the
    // prospecting gate above for why.
    const campaignTrackingSpec = hasCampaignTrackingIntent ? this.registry.getById(CAMPAIGN_TRACKING_AGENT_ID) : undefined;
    if (hasCampaignTrackingIntent && campaignTrackingSpec) {
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: CAMPAIGN_TRACKING_AGENT_ID,
        taskIntent,
        candidates: [{ agentId: campaignTrackingSpec.id, agentTitle: campaignTrackingSpec.title, score: 1, matchedTerms: [] }],
        rationale:
          "This request clearly asks to track/update the status of one specific, named campaign -- a deterministic " +
          "capability gate assigned it directly to the Campaign Tracking Agent (real, persisted campaign records) " +
          "before generic specialist scoring.",
        decidedAt,
      };
    }

    const requiredCapabilities = extractRequiredCapabilities(task.description);

    // Boss Agent IS the orchestration authority -- see this file's header
    // comment. Checked BEFORE specialist gating/scoring, and before any
    // other required capability is considered: a task that touches
    // orchestration at all is never a task for an ordinary specialist
    // pipeline to partially handle, per Agents/BossAgent.md's own Rules
    // ("Coordinate only; do not replace specialist agents" cuts the other
    // way too -- Boss does not hand its OWN machinery to a specialist that
    // has no access to it).
    if (requiredCapabilities.has(ORCHESTRATION_CAPABILITY) && this.bossAgentSpec) {
      return {
        taskId: task.id,
        status: "boss_retained",
        taskIntent,
        candidates: [],
        rationale:
          "This task requires the Boss Agent's own orchestration authority (task classification, routing, " +
          "capability-registry inspection, tool/access gating, execution/rejection-state control, or final " +
          "synthesis -- see Agents/BossAgent.md's Capabilities). No specialist agent has access to that " +
          "machinery, so the Boss Agent retains and handles this task directly rather than delegating it.",
        decidedAt,
      };
    }

    const requiredGatingCapabilities = GATING_CAPABILITIES.filter((cap) => requiredCapabilities.has(cap));

    const allCandidates = this.registry.list();
    const eligibleCandidates = requiredGatingCapabilities.length > 0 ? this.filterEligible(allCandidates, requiredGatingCapabilities) : allCandidates;

    if (requiredGatingCapabilities.length > 0 && eligibleCandidates.length === 0) {
      for (const capability of requiredGatingCapabilities) {
        this.rejectionTracker.recordUnavailableCapability(
          task.id,
          capability,
          `No candidate in the routable registry has real "${capability}" tool/access.`,
        );
      }
      return this.capabilityUnavailableDecision(task, allCandidates, decidedAt, taskIntent);
    }

    const ranked = eligibleCandidates.map((spec) => this.strategy.score(task, spec)).sort((a, b) => b.score - a.score);
    const topCandidates = ranked.slice(0, this.config.maxCandidates);

    const best = ranked[0];
    if (!best || best.score <= 0) {
      return {
        taskId: task.id,
        status: "escalated",
        taskIntent,
        candidates: topCandidates,
        rationale:
          "No specialist agent's stated mission, responsibilities, inputs, or outputs matched any meaningful term in this task description.",
        decidedAt,
        escalationReason: "no_matching_candidate",
      };
    }

    const runnerUp = ranked[1];
    const leadOverRunnerUp = runnerUp ? best.score - runnerUp.score : best.score;
    const meetsThreshold = best.score >= this.config.autoAssignThreshold;
    const meetsTieMargin = leadOverRunnerUp >= this.config.tieMargin;

    if (meetsThreshold && meetsTieMargin) {
      return {
        taskId: task.id,
        status: "assigned",
        assignedAgentId: best.agentId,
        taskIntent,
        candidates: topCandidates,
        rationale:
          `Matched term(s) [${best.matchedTerms.join(", ")}] against "${best.agentTitle}"` +
          ` (score ${best.score.toFixed(2)}) with a clear lead over the next candidate.`,
        decidedAt,
      };
    }

    let rationale: string;
    if (!meetsThreshold) {
      rationale =
        `Best match "${best.agentTitle}" scored ${best.score.toFixed(2)}, below the ` +
        `auto-assign threshold of ${this.config.autoAssignThreshold.toFixed(2)}.`;
    } else if (runnerUp) {
      rationale =
        `Best match "${best.agentTitle}" (${best.score.toFixed(2)}) is too close to runner-up ` +
        `"${runnerUp.agentTitle}" (${runnerUp.score.toFixed(2)}) to assign automatically.`;
    } else {
      rationale =
        `Best match "${best.agentTitle}" (${best.score.toFixed(2)}) did not reach the configured ` +
        `tie margin of ${this.config.tieMargin.toFixed(2)}.`;
    }

    return {
      taskId: task.id,
      status: "escalated",
      taskIntent,
      candidates: topCandidates,
      rationale,
      decidedAt,
      escalationReason: meetsThreshold ? "ambiguous_match" : "low_confidence_match",
    };
  }

  /** HARD gate: a candidate must be eligible for every required gating capability, not just score well. Filtering happens before any scoring call. */
  private filterEligible(candidates: readonly AgentSpec[], requiredGatingCapabilities: readonly CapabilityClass[]): AgentSpec[] {
    return candidates.filter((spec) => {
      const toolsAndCapabilities = [...spec.tools, ...spec.capabilities];
      return requiredGatingCapabilities.every((capability) => isCandidateEligibleFor(capability, spec.id, toolsAndCapabilities));
    });
  }

  private capabilityUnavailableDecision(task: TaskInput, consideredCandidates: readonly AgentSpec[], decidedAt: string, taskIntent?: TaskIntent): RoutingDecision {
    return {
      taskId: task.id,
      status: "escalated",
      taskIntent,
      candidates: consideredCandidates.map((spec) => ({ agentId: spec.id, agentTitle: spec.title, score: 0, matchedTerms: [] })),
      rationale: CAPABILITY_UNAVAILABLE_RATIONALE,
      decidedAt,
      escalationReason: "capability_unavailable",
    };
  }
}
