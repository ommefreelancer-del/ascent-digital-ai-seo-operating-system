import { randomUUID } from "node:crypto";

// A non-interactive ApprovalChannel for the web app. The frozen backend's
// governance model (GLOBAL_RULES.md SS9/SS13) requires a human in the loop
// for uncertain or high-impact decisions; the CLI satisfies that with a
// blocking terminal prompt, which has no equivalent in a stateless HTTP
// request. This channel auto-resolves to the top-ranked candidate (or
// rejects when there is none) so a request never hangs -- but it never
// hides that an escalation happened: every real reason, summary, and
// candidate list considered is reported back to the caller via
// `onEscalation`, so the UI can surface it honestly (Execution Logs,
// Recent Activity) instead of silently pretending high confidence.
//
// A real human-approval inbox (reviewing/resolving these before they
// auto-resolve) is a natural v2.1 addition, not built in this pass -- see
// the final report's recommendations.
//
// CAPABILITY_UNAVAILABLE MUST NEVER AUTO-RESOLVE (2026-08-14 client-workflow
// pass, a real, serious production defect this fixes): TaskRouter's
// "capability_unavailable" decision (src/boss-agent/routing/task-router.ts)
// carries its full `candidates` list purely for AUDIT purposes -- every
// entry has `score: 0` and is explicitly NOT a ranked recommendation (see
// TaskRouter.capabilityUnavailableDecision()'s own comment). This channel
// used to auto-pick `candidates[0]` regardless of `request.reason`, which
// meant a request Boss had already correctly, honestly determined NO real
// agent can execute (e.g. "fix the robots.txt issues" once the capability-
// eligibility fix made technical-remediation's real, chat-dispatch-wired
// eligible set empty) got silently reassigned to whichever agent happened to
// be first in registry iteration order (observed in real testing:
// "Admin Agent", with a real rationale reading "Auto-resolved to the
// top-ranked option" -- a fabricated assignment with zero actual basis).
// This directly defeats the whole point of the capability-unavailable
// outcome: an honest "ADASOS cannot do this yet" was being silently
// converted into a fake, confident-sounding assignment. Fixed by never
// auto-resolving this one reason -- it always resolves to "rejected" with an
// honest, specific note, preserving the truthful outcome through
// EscalationHandler's own "rejected" path (see escalation-handler.ts).

export interface EscalationCandidate {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly rationale: string;
}

export interface ApprovalRequestShape {
  readonly id: string;
  readonly reason: string;
  readonly summary: string;
  readonly candidates: readonly EscalationCandidate[];
}

export interface RecordedEscalation {
  readonly id: string;
  readonly reason: string;
  readonly summary: string;
  readonly candidateLabels: readonly string[];
  readonly resolvedLabel: string | null;
  readonly decidedAt: string;
}

const CAPABILITY_UNAVAILABLE_REASON = "capability_unavailable";
// 2026-08-14 remediation-execution pass: a real, registered execution
// adapter making a production-affecting change (repository write,
// deployment) is exactly the "high-impact decision" GLOBAL_RULES.md SS9/SS13
// require genuine human approval for -- auto-picking candidates[0] for this
// reason would silently authorize a real deployment with no actual human
// decision behind it. See src/boss-agent/remediation/remediation-orchestrator.ts,
// which only ever requests this reason when a real adapter exists to act on
// an approval.
const DEPLOY_PRODUCTION_CHANGE_REASON = "deploy_production_change";
// LOW-CONFIDENCE ROUTING FIX (2026-08-16, a real, live production defect):
// src/boss-agent/routing/task-router.ts's own escalation reasons for a
// routing decision that did NOT meet the auto-assign threshold or tie
// margin -- "low_confidence_match" (best score below the configured
// threshold) and "ambiguous_match" (best score clears the threshold but is
// too close to the runner-up to call confidently). BOTH used to fall
// through to the generic candidates[0] auto-pick below, exactly like every
// OTHER escalation reason -- meaning TaskRouter's own honest "I am not
// confident enough to auto-assign" signal (best.score <= this.config.
// autoAssignThreshold, e.g. a real, live production case: 0.31 scored
// against a 0.50 threshold) was silently converted into a confident-sounding
// "Auto-resolved to the top-ranked option" assignment anyway -- the exact
// same fabricated-confidence defect this file's own CAPABILITY_UNAVAILABLE
// fix above already closed for a different escalation reason, left open for
// these two. Same fix, same reasoning: candidates[] for a low-confidence/
// ambiguous escalation is not a real recommendation to auto-pick from, it is
// TaskRouter's own audit trail of what it considered and rejected as too
// uncertain. A clearly-identified request should instead reach its correct
// specialist via a deterministic capability/intent gate BEFORE scoring (see
// src/boss-agent/routing/prospecting-intent-detector.ts for the concrete
// gate this defect's own root-cause investigation added) -- never by
// pretending an uncertain score is a confident one.
const LOW_CONFIDENCE_MATCH_REASON = "low_confidence_match";
const AMBIGUOUS_MATCH_REASON = "ambiguous_match";
// STRICT PRODUCTION REPAIR (2026-08-17): src/boss-agent/routing/task-router.ts's
// own escalation reason for a request that explicitly names a specific
// agent that does not exist anywhere in the real, registered roster (see
// explicit-agent-match.ts's findUnresolvedAgentMention()). candidates[] is
// always empty for this reason (there is genuinely nothing to recommend),
// so the generic auto-pick below would already fall through to its own
// "no candidate was available" rejection -- this entry exists so the NOTES
// message is specific and honest ("this agent doesn't exist") rather than
// the generic empty-candidate message.
const REQUESTED_AGENT_NOT_FOUND_REASON = "requested_agent_not_found";
const NEVER_AUTO_RESOLVE_REASONS: ReadonlySet<string> = new Set([
  CAPABILITY_UNAVAILABLE_REASON,
  DEPLOY_PRODUCTION_CHANGE_REASON,
  LOW_CONFIDENCE_MATCH_REASON,
  AMBIGUOUS_MATCH_REASON,
  REQUESTED_AGENT_NOT_FOUND_REASON,
]);

const NEVER_AUTO_RESOLVE_NOTES: Readonly<Record<string, string>> = {
  [CAPABILITY_UNAVAILABLE_REASON]: "I've identified what this needs, but ADASOS doesn't currently have real, working access to do it automatically.",
  [DEPLOY_PRODUCTION_CHANGE_REASON]:
    "This would make a real, production-affecting change. A non-interactive web request cannot supply genuine human authorization for that, so it stays pending real approval rather than auto-proceeding.",
  [LOW_CONFIDENCE_MATCH_REASON]:
    "No specialist scored confidently enough against this request to auto-assign it. Please rephrase with more specific detail about what you need, or specify the agent/capability directly.",
  [AMBIGUOUS_MATCH_REASON]:
    "Two or more specialists scored too closely to auto-assign this request with confidence. Please rephrase with more specific detail, or specify which capability you need.",
  [REQUESTED_AGENT_NOT_FOUND_REASON]:
    "The agent you named doesn't exist in ADASOS's real, registered specialist roster, and there's no similarly named agent I can safely substitute. Please check the agent name, or describe the capability you need instead.",
};

export function createWebApprovalChannel(onEscalation?: (event: RecordedEscalation) => void) {
  return {
    async requestDecision(request: ApprovalRequestShape) {
      const decidedAt = new Date().toISOString();

      // See this file's own header comments on CAPABILITY_UNAVAILABLE and
      // DEPLOY_PRODUCTION_CHANGE: neither reason's candidate list is a real
      // recommendation to auto-pick from -- one is audit-only (every entry
      // score: 0), the other represents a real production action that must
      // never proceed without genuine human authorization.
      if (NEVER_AUTO_RESOLVE_REASONS.has(request.reason)) {
        onEscalation?.({
          id: randomUUID(),
          reason: request.reason,
          summary: request.summary,
          candidateLabels: request.candidates.map((c) => c.label),
          resolvedLabel: null,
          decidedAt,
        });
        return {
          requestId: request.id,
          outcome: "rejected" as const,
          notes: NEVER_AUTO_RESOLVE_NOTES[request.reason] ?? "This requires genuine human approval and cannot be auto-resolved.",
          decidedAt,
        };
      }

      const candidate = request.candidates[0] ?? null;

      onEscalation?.({
        id: randomUUID(),
        reason: request.reason,
        summary: request.summary,
        candidateLabels: request.candidates.map((c) => c.label),
        resolvedLabel: candidate?.label ?? null,
        decidedAt,
      });

      if (!candidate) {
        return { requestId: request.id, outcome: "rejected" as const, notes: "No candidate was available to auto-resolve.", decidedAt };
      }
      return {
        requestId: request.id,
        outcome: "candidate_selected" as const,
        selectedCandidateId: candidate.id,
        notes: `Auto-resolved to the top-ranked option ("${candidate.label}") for a non-blocking web request.`,
        decidedAt,
      };
    },
  };
}
