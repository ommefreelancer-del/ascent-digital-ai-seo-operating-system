// Input/output shapes for the Conversation & Language Manager, per
// docs/architecture/ConversationLanguageManager.md. This module is the
// single conversational gateway in front of the Boss Agent: it never
// executes specialist-agent work itself (that stays out of scope, exactly
// as it is for the Boss Agent's own `run()` -- see src/boss-agent/boss-agent.ts,
// which only ever produces a RoutingDecision). It packages a validated,
// language-aware request into a real Boss Agent TaskInput, forwards it to
// the injected BossAgentGateway, and presents the real RoutingDecision back
// to the user -- it never fabricates what a specialist agent would have
// done.

import type { RoutingDecision } from "../../boss-agent/types/routing.types.js";
import type { TaskInput, TaskPriority } from "../../boss-agent/types/task.types.js";

/** Languages this build can detect and reply in. Widening this list is additive, per the architecture doc's "Future Expansion" section. */
export type SupportedLanguage = "en" | "ur";

export interface ConversationRequest {
  readonly sessionId: string;
  readonly message: string;
  /** Explicit override; when omitted, the language is detected from `message`. */
  readonly languageOverride?: SupportedLanguage;
  readonly priority?: TaskPriority;
}

export type ConversationTurnRole = "user" | "assistant";

export interface ConversationTurn {
  readonly role: ConversationTurnRole;
  readonly text: string;
  readonly occurredAt: string;
}

export interface ConversationSession {
  readonly sessionId: string;
  readonly language: SupportedLanguage;
  readonly history: readonly ConversationTurn[];
}

/**
 * "task_request" -- the message carries enough real content to package and
 * route to a specialist agent via the Boss Agent. "clarification_needed" --
 * per the architecture doc's own Intent Detection responsibility ("Whether
 * additional clarification is required"), a message too short to route is
 * never guessed at; the user is asked for more detail instead.
 * "boss_agent_meta_request" -- the message is about the Boss Agent's own
 * routing/orchestration behavior (see routing/boss-agent-meta-request-detector.ts),
 * not a task for any specialist; the Boss Agent is never called, so no
 * specialist can be assigned.
 */
export type ConversationIntent = "task_request" | "clarification_needed" | "boss_agent_meta_request";

export interface ConversationResponse {
  readonly sessionId: string;
  readonly language: SupportedLanguage;
  readonly intent: ConversationIntent;
  readonly reply: string;
  /** `null` when intent is "clarification_needed" or "boss_agent_meta_request": the Boss Agent was never called. */
  readonly routingDecision: RoutingDecision | null;
  readonly decidedAt: string;
}

/**
 * The minimal surface this module needs from the Boss Agent, per its own
 * "Boss Agent Integration" responsibility ("Sends structured requests to
 * the Boss Agent", "Receives final responses"). Depending on this interface
 * (rather than the concrete BossOrchestrator class) lets this module's own
 * tests use a fake with no real agent registry or file system involved --
 * the same pattern TaskRouter/ComplianceValidator use for AgentDirectory.
 * A real `BossOrchestrator` instance satisfies this structurally, unchanged.
 */
export interface BossAgentGateway {
  run(tasks: readonly TaskInput[]): Promise<{ readonly runId: string; readonly outcomes: readonly { readonly task: TaskInput; readonly decision: RoutingDecision }[] }>;
}
