// Detects messages that are ABOUT the Boss Agent's own routing/orchestration
// machinery (not a task for a specialist agent to perform). Real, live
// testing found that every such message -- e.g. "Explain why routing
// failed.", "Debug Boss Agent." -- was still being forwarded to
// bossAgentGateway.run(), because nothing in this module or the Boss Agent
// itself recognizes "this question is about the router, not a task for a
// specialist." TaskRouter has no self-referential candidate (BossAgent
// itself is explicitly excluded from the registry -- see
// src/boss-agent/registry/agent-registry.ts's BOSS_AGENT_SPEC_ID), so these
// messages always scored low/ambiguous against the real specialist registry,
// escalated, and -- in the web app -- got silently auto-resolved to
// whichever specialist happened to score marginally highest (see
// web/src/server/backend/approval.ts's createWebApprovalChannel, which
// always picks candidates[0] rather than truly declining). A specialist
// agent then correctly reported it has no routing logs, confidence scores,
// or registry access, because it never did.
//
// This is a small, deterministic, word-boundary keyword check -- consistent
// with IntentClassifier's own word-count heuristic in this same module --
// not a fabricated understanding of intent. A false positive here just means
// a legitimately routable task gets a short "handled here, not routed"
// reply instead of being assigned; a false negative means the pre-existing
// behavior (forwarded to the Boss Agent) is unchanged. Neither case
// fabricates data or hides what happened.

const TRIGGER_TERMS: readonly string[] = [
  "boss agent",
  "routing",
  "orchestrator",
  "classifier",
  "registry",
  "confidence",
  "debug routing",
];

function buildTriggerPattern(): RegExp {
  const escaped = TRIGGER_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

const TRIGGER_PATTERN = buildTriggerPattern();

export class BossAgentMetaRequestDetector {
  /** True if `message` is about the Boss Agent's own routing/orchestration behavior rather than a task to route. */
  isMetaRequest(message: string): boolean {
    return TRIGGER_PATTERN.test(message);
  }
}
