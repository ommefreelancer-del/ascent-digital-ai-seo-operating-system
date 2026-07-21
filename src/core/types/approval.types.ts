// Shared contract for asking a human to resolve something the system cannot
// safely decide on its own. GLOBAL_RULES.md SS9 (Human Approval Policy) and
// SS13 (Approval Escalation Policy) require that uncertain or high-impact
// decisions are put in front of a human rather than guessed. This type is
// deliberately generic (not Boss-Agent-specific) so any future agent can
// reuse the same human-in-the-loop contract.

/** Why a decision is being escalated to a human reviewer. */
export type EscalationReason =
  | "no_matching_candidate"
  | "ambiguous_match"
  | "low_confidence_match";

/** One option the human reviewer can choose between. */
export interface ApprovalCandidate {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly rationale: string;
}

/** A question raised for a human reviewer, with enough context to decide. */
export interface ApprovalRequest {
  readonly id: string;
  readonly reason: EscalationReason;
  readonly summary: string;
  readonly candidates: readonly ApprovalCandidate[];
  readonly createdAt: string;
}

/** The human reviewer's recorded decision for an ApprovalRequest. */
export interface ApprovalDecision {
  readonly requestId: string;
  readonly outcome: "candidate_selected" | "rejected";
  readonly selectedCandidateId?: string;
  readonly notes: string;
  readonly decidedAt: string;
}
