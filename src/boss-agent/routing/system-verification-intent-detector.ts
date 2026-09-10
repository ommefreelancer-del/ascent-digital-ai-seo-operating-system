// PRODUCTION-READINESS VERIFICATION ROUTING FIX (2026-08-19): a real,
// reported production defect -- a read-only request asking to verify the
// SYSTEM ITSELF (agent routing correctness, tool/resource availability, the
// Phase 5 gate's own configuration, tenant-isolation enforcement, or overall
// production readiness) was being classified as an SEO/remediation workflow
// task-intent-classifier.ts (via its bare AUDIT_PHRASES/REMEDIATE_PHRASES/
// APPROVAL_PHRASES substring matches -- a verification request naturally
// describes SEO-adjacent concepts like "remediation" or "approval" as part
// of WHAT it verifies, without asking for an SEO task at all) and routed
// into Boss's own audit-first orchestrated pipeline in
// web/src/app/api/workspace/messages/route.ts, running a live SEO audit
// against a real site.
//
// This is exactly the Boss Agent's own "orchestration authority" domain
// already documented on the "boss_retained" status (see
// types/routing.types.ts's own doc comment: "task classification, routing,
// capability-registry inspection, tool/access gating, execution/
// rejection-state control...") -- no specialist agent has genuine access to
// its own routing/registry/capability-gating/approval-state internals, only
// Boss itself does. capability-classifier.ts's existing "orchestration"
// trigger phrases already cover requests ABOUT Boss's routing machinery
// (e.g. "routing logic", "agent registry"), but that check runs AFTER
// classifyTaskIntent()'s own SEO-stage short-circuit in task-router.ts --
// too late once a verification request happens to also mention an
// SEO-adjacent word. Checked here, at the SAME early tier as
// human-approval-gate-intent-detector.ts (after that gate's own,
// deliberately more specific phrases -- "verify the Human Approval Gate"
// keeps its precise, real-pending-approval-state routing; only a GENERIC
// "verify the gate's configuration/behavior" ask reaches this detector) and
// BEFORE classifyTaskIntent()'s short-circuit, so a genuine system/
// production-readiness verification request is never dragged into an SEO
// task regardless of which SEO-adjacent words it uses to describe what it's
// checking.
//
// Deliberately narrow, multi-word phrases only -- no bare "verify"/
// "system"/"check", which are ordinary words a real client SEO/website
// request can plausibly use (see this project's own established discipline
// on this in capability-classifier.ts's and
// boss-agent-meta-request-detector.ts's own headers).

const SYSTEM_VERIFICATION_PHRASES: readonly string[] = [
  "system verification",
  "verify the system",
  "verify this system",
  "system readiness",
  "production readiness",
  "production-readiness",
  "readiness verification",
  "readiness check",
  "agent routing verification",
  "routing verification",
  "verify agent routing",
  "verify the agent routing",
  "verify routing configuration",
  "tool verification",
  "resource verification",
  "tool availability",
  "resource availability",
  "tool/resource verification",
  "tool and resource verification",
  "verify tool availability",
  "verify resource availability",
  "gate verification",
  "verify the gate",
  "verify gate configuration",
  "tenant isolation",
  "workspace isolation",
  "isolation verification",
  "verify tenant isolation",
  "verify workspace isolation",
];

function includesAny(lower: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => lower.includes(phrase));
}

/**
 * True when `taskDescription` explicitly asks to verify the SYSTEM itself
 * (routing/tool-resource/gate-configuration/tenant-isolation/production
 * readiness) rather than asking for an SEO/website task -- narrow enough
 * that a genuine SEO request never false-positives here. See file header.
 */
export function isSystemVerificationIntent(taskDescription: string): boolean {
  const lower = ` ${taskDescription.toLowerCase()} `;
  return includesAny(lower, SYSTEM_VERIFICATION_PHRASES);
}
