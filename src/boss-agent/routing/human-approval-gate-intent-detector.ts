// HUMAN APPROVAL GATE ROUTING FIX (2026-08-19): a real, live production
// defect -- an explicit request to inspect/test the Human Approval Gate
// (e.g. "Run the Human Approval Gate validation") was being classified by
// task-intent-classifier.ts as "end_to_end_seo" (its APPROVAL_PHRASES list
// includes "human approval", and real Phase-5-style messages also mention
// audit/remediation/verification language in the same breath), which
// task-router.ts short-circuits straight into Boss's full, linear
// Audit -> Remediation -> Approval -> ... pipeline -- always starting with a
// live SEO audit of whatever site was last audited for this account. There
// is no way to reach "just the approval gate" through that pipeline: the
// approval-gate logic in web/src/server/backend/remediation.ts is a MIDDLE
// stage of a fixed sequence, never an independently routable target.
//
// This module detects the narrow, unambiguous case: the message is ABOUT
// the Human Approval Gate itself (checking/testing/inspecting its state) --
// not a genuine multi-stage client workflow that merely mentions "approval"
// as one of many stages it needs (see the PRODUCTION ROUTING FIX example in
// task-intent-classifier.ts's own header: "...ask for approval before
// production changes, execute the approved fixes, deploy them..." must
// KEEP routing to "end_to_end_seo" -- that is a real end-to-end client
// request, not a request about the gate mechanism). Only the literal,
// named-concept phrases below count; a bare "approval" or "ask for
// approval" is deliberately NOT enough, exactly the same "explicit workflow
// naming is an unambiguous signal on its own" precedent
// task-intent-classifier.ts's own PRODUCTION_VALIDATION_PHRASES already
// established for "production validation"/"workflow validation".

const HUMAN_APPROVAL_GATE_PHRASES: readonly string[] = [
  "human approval gate",
  "approval gate",
  "pending approval",
  "pending approvals",
  "pending human approval",
];

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

/**
 * True when `taskDescription` explicitly names the Human Approval Gate as
 * its own subject -- narrow enough to leave a genuine multi-stage client
 * request (which may also mention "approval" as one of several stages)
 * routing to "end_to_end_seo" exactly as before. See file header.
 */
export function isHumanApprovalGateIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;
  return includesAny(lower, HUMAN_APPROVAL_GATE_PHRASES);
}
