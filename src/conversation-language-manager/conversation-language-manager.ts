// Conversation & Language Manager, per docs/architecture/ConversationLanguageManager.md.
//
// Workflow:
//   1. Validate the request: a non-empty message.
//   2. Log "conversation_message_received".
//   3. Scan the real message for prompt-injection signals (instruction
//      override, system-prompt disclosure, role override). If found,
//      escalate to a human via the "prompt_injection" reason before this
//      request ever reaches the Boss Agent -- per this module's own rule to
//      "enforce governance policies" and "never bypass the platform's
//      security architecture."
//   4. Detect the real message's language (or use the caller's explicit
//      override) and record it on the session.
//   5. Append the user's real turn to the session history.
//   6. Classify intent from the real message. A message too short to route
//      is never guessed at -- the user is asked for clarification, and the
//      Boss Agent is never called.
//   7. Otherwise, package a real Boss Agent TaskInput and forward it to the
//      injected BossAgentGateway (a real BossOrchestrator in production).
//      This module never executes specialist-agent work itself, and never
//      fabricates what a specialist agent would have done -- it only
//      presents the real RoutingDecision the Boss Agent actually produced.
//   8. Append the assistant's real reply to the session history.
//   9. Log "conversation_message_handled" and return.
//
// GLOBAL_RULES.md SS2 (Anti-Hallucination): this module never invents a
// routing outcome, a specialist agent's findings, or a fact about the
// conversation. No specialist agent is invoked directly here -- only the
// Boss Agent, exactly as its own public API allows (src/boss-agent/boss-agent.ts).

import { randomUUID } from "node:crypto";
import type { ApprovalChannel } from "../core/governance/approval-channel.js";
import { CliApprovalChannel } from "../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../core/governance/audit-logger.js";
import type { ApprovalRequest } from "../core/types/approval.types.js";
import type { TaskInput } from "../boss-agent/types/task.types.js";
import type { ConversationLanguageManagerConfig } from "./config/conversation-language-manager.config.js";
import { ConversationRequestValidator } from "./validation/conversation-request-validator.js";
import { LanguageDetector } from "./language/language-detector.js";
import { IntentClassifier } from "./intent/intent-classifier.js";
import { ReplyTemplateBuilder } from "./reply/reply-template-builder.js";
import { InMemoryConversationSessionStore, type ConversationSessionStore } from "./session/conversation-session-store.js";
import type { BossAgentGateway, ConversationRequest, ConversationResponse } from "./types/conversation.types.js";

const PROCEED_CANDIDATE_ID = "proceed";

export class ConversationLanguageManager {
  constructor(
    private readonly validator: ConversationRequestValidator,
    private readonly languageDetector: LanguageDetector,
    private readonly intentClassifier: IntentClassifier,
    private readonly replyTemplateBuilder: ReplyTemplateBuilder,
    private readonly sessionStore: ConversationSessionStore,
    private readonly bossAgentGateway: BossAgentGateway,
    private readonly approvalChannel: ApprovalChannel,
    private readonly auditLogger: AuditLogger,
  ) {}

  static async create(
    config: ConversationLanguageManagerConfig,
    bossAgentGateway: BossAgentGateway,
    approvalChannel: ApprovalChannel = new CliApprovalChannel(),
    sessionStore: ConversationSessionStore = new InMemoryConversationSessionStore(),
  ): Promise<ConversationLanguageManager> {
    return new ConversationLanguageManager(
      new ConversationRequestValidator(),
      new LanguageDetector(),
      new IntentClassifier(),
      new ReplyTemplateBuilder(),
      sessionStore,
      bossAgentGateway,
      approvalChannel,
      new AuditLogger(config.auditLogPath),
    );
  }

  async handleMessage(request: ConversationRequest): Promise<ConversationResponse> {
    try {
      this.validator.validate(request);
    } catch (error) {
      await this.auditLogger.logEvent({
        actor: "conversation-language-manager",
        eventType: "conversation_validation_failed",
        details: { sessionId: request.sessionId, reason: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    await this.auditLogger.logEvent({
      actor: "conversation-language-manager",
      eventType: "conversation_message_received",
      details: { sessionId: request.sessionId, messageLength: request.message.length },
    });

    const injectionSignals = this.validator.findPromptInjectionSignals(request);
    if (injectionSignals.length > 0) {
      const approved = await this.escalatePromptInjection(request, injectionSignals);
      if (!approved) {
        await this.auditLogger.logEvent({
          actor: "conversation-language-manager",
          eventType: "conversation_rejected",
          details: {
            sessionId: request.sessionId,
            reason: "Human reviewer declined to proceed with a message containing prompt-injection signals.",
            signals: injectionSignals,
          },
        });
        throw new Error("Conversation request was rejected by human review due to prompt-injection signals.");
      }
    }

    const language = this.languageDetector.detect(request.message, request.languageOverride);
    this.sessionStore.setLanguage(request.sessionId, language);

    const now = new Date().toISOString();
    this.sessionStore.appendTurn(request.sessionId, { role: "user", text: request.message, occurredAt: now });

    const intent = this.intentClassifier.classify(request.message);

    if (intent === "clarification_needed") {
      const reply = this.replyTemplateBuilder.clarification(language);
      this.sessionStore.appendTurn(request.sessionId, { role: "assistant", text: reply, occurredAt: new Date().toISOString() });

      await this.auditLogger.logEvent({
        actor: "conversation-language-manager",
        eventType: "conversation_message_handled",
        details: { sessionId: request.sessionId, intent, routedToBossAgent: false },
      });

      return {
        sessionId: request.sessionId,
        language,
        intent,
        reply,
        routingDecision: null,
        decidedAt: new Date().toISOString(),
      };
    }

    const taskInput: TaskInput = {
      id: randomUUID(),
      description: request.message,
      priority: request.priority ?? "normal",
    };
    const runSummary = await this.bossAgentGateway.run([taskInput]);
    const outcome = runSummary.outcomes[0];
    if (!outcome) {
      throw new Error("Internal error: the Boss Agent gateway returned no outcome for the submitted task.");
    }

    const reply = this.replyTemplateBuilder.routing(outcome.decision, language);
    this.sessionStore.appendTurn(request.sessionId, { role: "assistant", text: reply, occurredAt: new Date().toISOString() });

    await this.auditLogger.logEvent({
      actor: "conversation-language-manager",
      eventType: "conversation_message_handled",
      details: {
        sessionId: request.sessionId,
        intent,
        routedToBossAgent: true,
        status: outcome.decision.status,
        assignedAgentId: outcome.decision.assignedAgentId,
      },
    });

    return {
      sessionId: request.sessionId,
      language,
      intent,
      reply,
      routingDecision: outcome.decision,
      decidedAt: new Date().toISOString(),
    };
  }

  private async escalatePromptInjection(request: ConversationRequest, signals: readonly string[]): Promise<boolean> {
    const approvalRequest: ApprovalRequest = {
      id: randomUUID(),
      reason: "prompt_injection",
      summary:
        `Conversation message in session "${request.sessionId}" contains term(s) associated with prompt-injection ` +
        `or unsafe instruction attempts: ${signals.join(", ")}. GLOBAL_RULES.md requires human approval before ` +
        "this reaches the Boss Agent.",
      candidates: [
        {
          id: PROCEED_CANDIDATE_ID,
          label: "Proceed and forward this message to the Boss Agent despite the flagged term(s)",
          score: 0,
          rationale: "Approving continues normal conversation handling.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await this.auditLogger.logEvent({
      actor: "conversation-language-manager",
      eventType: "conversation_escalated",
      details: { sessionId: request.sessionId, approvalRequestId: approvalRequest.id, signals },
    });

    const decision = await this.approvalChannel.requestDecision(approvalRequest);

    await this.auditLogger.logEvent({
      actor: "conversation-language-manager",
      eventType: "conversation_escalation_resolved",
      details: {
        sessionId: request.sessionId,
        approvalRequestId: approvalRequest.id,
        outcome: decision.outcome,
        notes: decision.notes,
      },
    });

    return decision.outcome === "candidate_selected" && decision.selectedCandidateId === PROCEED_CANDIDATE_ID;
  }
}
