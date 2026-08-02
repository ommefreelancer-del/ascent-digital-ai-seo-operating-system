// Adapter over the frozen Conversation Language Manager
// (../../../../dist/src/conversation-language-manager) and the Boss Agent
// stack it forwards routing to. Everything is constructed manually (never
// via BossAgent.create()/BossOrchestrator.create(), which hardcode the
// interactive CliApprovalChannel with no override) so a real, non-blocking
// WebApprovalChannel can be injected. This exercises the real CLM: language
// detection, intent classification, prompt-injection escalation, and Boss
// Agent routing -- it never executes a specialist agent itself, matching
// the CLM's own documented contract. getSpecialistAgentSpec() below exposes
// a read-only lookup into the same registry purely so the caller (see
// app/api/workspace/messages) can have the *already-assigned* specialist's
// real spec (mission/responsibilities/rules) role-played by Claude -- this
// happens strictly after routing and never influences the RoutingDecision.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel, type RecordedEscalation } from "./approval";
import type { ConversationResponse } from "./types";
import type { SpecialistAgentSpec } from "./specialist-ai";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  const target = path.join(backendDist, relativeToSrc);
  return import(/* webpackIgnore: true */ `file://${target}`);
}

interface ClmBundle {
  readonly clm: { handleMessage(request: { sessionId: string; message: string; priority?: "high" | "normal" | "low" }): Promise<ConversationResponse> };
  readonly escalations: RecordedEscalation[];
  /** Read-only spec lookup for the same registry the Boss Agent routed against -- used only to build a specialist's system prompt after routing, never to influence the routing decision itself. */
  readonly getAgentSpec: (agentId: string) => SpecialistAgentSpec | undefined;
}

let clmPromise: Promise<ClmBundle> | null = null;

async function getClm(): Promise<ClmBundle> {
  if (!clmPromise) {
    clmPromise = (async () => {
      const [
        { BossAgent },
        { BossOrchestrator },
        { AgentRegistry },
        { TagWeightedRoutingStrategy },
        { TaskRouter },
        { ComplianceValidator },
        { EscalationHandler },
        { TaskStateStore },
        { AuditLogger },
        { loadBossAgentConfig },
        { ConversationLanguageManager },
        { loadConversationLanguageManagerConfig },
      ] = await Promise.all([
        importBackend("boss-agent/boss-agent.js"),
        importBackend("boss-agent/boss-orchestrator.js"),
        importBackend("boss-agent/registry/agent-registry.js"),
        importBackend("boss-agent/routing/tag-weighted-routing-strategy.js"),
        importBackend("boss-agent/routing/task-router.js"),
        importBackend("boss-agent/governance/compliance-validator.js"),
        importBackend("boss-agent/governance/escalation-handler.js"),
        importBackend("boss-agent/state/task-state-store.js"),
        importBackend("core/governance/audit-logger.js"),
        importBackend("boss-agent/config/boss-agent.config.js"),
        importBackend("conversation-language-manager/conversation-language-manager.js"),
        importBackend("conversation-language-manager/config/conversation-language-manager.config.js"),
      ]);

      const bossConfig = loadBossAgentConfig(
        {
          agentsDirectory: path.join(backendRoot, "Agents"),
          stateDirectory: path.join(backendRoot, "var", "web", "boss-agent", "state"),
          auditLogPath: path.join(backendRoot, "var", "web", "boss-agent", "audit-log.jsonl"),
        },
        backendRoot,
      );

      const registry = await AgentRegistry.load(bossConfig.agentsDirectory);
      const routingStrategy = new TagWeightedRoutingStrategy();
      const taskRouter = new TaskRouter(registry, routingStrategy, {
        autoAssignThreshold: bossConfig.autoAssignThreshold,
        tieMargin: bossConfig.tieMargin,
        maxCandidates: bossConfig.maxCandidates,
      });

      const escalations: RecordedEscalation[] = [];
      const approvalChannel = createWebApprovalChannel((event) => escalations.push(event));
      const bossAuditLogger = new AuditLogger(bossConfig.auditLogPath);
      const escalationHandler = new EscalationHandler(approvalChannel, bossAuditLogger);
      const complianceValidator = new ComplianceValidator();
      const taskStateStore = new TaskStateStore(bossConfig.stateDirectory);
      const bossAgent = new BossAgent(registry, taskRouter, complianceValidator, escalationHandler, bossAuditLogger, taskStateStore);
      const orchestrator = new BossOrchestrator(bossAgent, bossAuditLogger);
      await orchestrator.start();

      const clmConfig = loadConversationLanguageManagerConfig(
        { auditLogPath: path.join(backendRoot, "var", "web", "conversation-language-manager", "audit-log.jsonl") },
        backendRoot,
      );
      const clm = await ConversationLanguageManager.create(clmConfig, orchestrator, approvalChannel);

      return { clm, escalations, getAgentSpec: (agentId: string) => registry.getById(agentId) };
    })();
  }
  return clmPromise;
}

export interface SendConversationMessageResult {
  readonly response: ConversationResponse;
  readonly escalations: readonly RecordedEscalation[];
}

/** Sends one message through the real CLM: language detection, intent classification, and (for task requests) real Boss Agent routing. Never fabricates specialist-agent execution. */
export async function sendConversationMessage(
  sessionId: string,
  message: string,
  priority: "high" | "normal" | "low" = "normal",
): Promise<SendConversationMessageResult> {
  const { clm, escalations } = await getClm();
  const before = escalations.length;
  const response = await clm.handleMessage({ sessionId, message, priority });
  return { response, escalations: escalations.slice(before) };
}

/** Looks up the real Agents/*.md spec (title, mission, responsibilities, rules) for the agent a RoutingDecision already assigned -- read-only, does not affect or repeat routing. */
export async function getSpecialistAgentSpec(agentId: string): Promise<SpecialistAgentSpec | undefined> {
  const { getAgentSpec } = await getClm();
  return getAgentSpec(agentId);
}
