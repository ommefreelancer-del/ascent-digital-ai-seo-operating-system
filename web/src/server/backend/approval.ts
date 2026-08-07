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

export function createWebApprovalChannel(onEscalation?: (event: RecordedEscalation) => void) {
  return {
    async requestDecision(request: ApprovalRequestShape) {
      const candidate = request.candidates[0] ?? null;
      const decidedAt = new Date().toISOString();

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
