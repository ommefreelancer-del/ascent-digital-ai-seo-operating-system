// Adapter over the frozen Boss Agent (../../../../dist/src/boss-agent).
// Constructed manually -- not via BossAgent.create()/BossOrchestrator.create(),
// which hardcode the interactive CliApprovalChannel -- so a real,
// non-blocking WebApprovalChannel can be injected instead. This still
// exercises the real, unmodified registry, routing strategy, router,
// compliance validator, and escalation handler; only the human-approval
// transport differs from the CLI.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApprovalChannel, type RecordedEscalation } from "./approval";
import type { RoutingDecision } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDist = path.resolve(here, "../../../../dist/src");
const backendRoot = path.resolve(here, "../../../..");

async function importBackend(relativeToSrc: string) {
  const target = path.join(backendDist, relativeToSrc);
  return import(/* webpackIgnore: true */ `file://${target}`);
}

interface BossAgentModules {
  readonly BossAgent: any;
  readonly registry: any;
  readonly TagWeightedRoutingStrategy: any;
  readonly TaskRouter: any;
  readonly ComplianceValidator: any;
  readonly EscalationHandler: any;
  readonly TaskStateStore: any;
  readonly AuditLogger: any;
  readonly config: any;
}

let modulesPromise: Promise<BossAgentModules> | null = null;

/** Loads the real agent registry from disk (Agents/*.md) once and caches it -- the only expensive step. */
async function getModules(): Promise<BossAgentModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [{ BossAgent }, { AgentRegistry }, { TagWeightedRoutingStrategy }, { TaskRouter }, { ComplianceValidator }, { EscalationHandler }, { TaskStateStore }, { AuditLogger }, { loadBossAgentConfig }] =
        await Promise.all([
          importBackend("boss-agent/boss-agent.js"),
          importBackend("boss-agent/registry/agent-registry.js"),
          importBackend("boss-agent/routing/tag-weighted-routing-strategy.js"),
          importBackend("boss-agent/routing/task-router.js"),
          importBackend("boss-agent/governance/compliance-validator.js"),
          importBackend("boss-agent/governance/escalation-handler.js"),
          importBackend("boss-agent/state/task-state-store.js"),
          importBackend("core/governance/audit-logger.js"),
          importBackend("boss-agent/config/boss-agent.config.js"),
        ]);

      const config = loadBossAgentConfig(
        {
          agentsDirectory: path.join(backendRoot, "Agents"),
          stateDirectory: path.join(backendRoot, "var", "web", "boss-agent", "state"),
          auditLogPath: path.join(backendRoot, "var", "web", "boss-agent", "audit-log.jsonl"),
        },
        backendRoot,
      );

      const registry = await AgentRegistry.load(config.agentsDirectory);

      return { BossAgent, registry, TagWeightedRoutingStrategy, TaskRouter, ComplianceValidator, EscalationHandler, TaskStateStore, AuditLogger, config };
    })();
  }
  return modulesPromise;
}

export interface RouteTaskResult {
  readonly decision: RoutingDecision;
  readonly escalations: readonly RecordedEscalation[];
}

/** Routes a single, real task description through the real Boss Agent. Never executes a specialist agent. */
export async function routeTask(description: string, priority: "high" | "normal" | "low" = "normal"): Promise<RouteTaskResult> {
  const m = await getModules();
  const escalations: RecordedEscalation[] = [];

  const routingStrategy = new m.TagWeightedRoutingStrategy();
  const taskRouter = new m.TaskRouter(m.registry, routingStrategy, {
    autoAssignThreshold: m.config.autoAssignThreshold,
    tieMargin: m.config.tieMargin,
    maxCandidates: m.config.maxCandidates,
  });
  const auditLogger = new m.AuditLogger(m.config.auditLogPath);
  const approvalChannel = createWebApprovalChannel((event) => escalations.push(event));
  const escalationHandler = new m.EscalationHandler(approvalChannel, auditLogger);
  const complianceValidator = new m.ComplianceValidator();
  const taskStateStore = new m.TaskStateStore(m.config.stateDirectory);
  const bossAgent = new m.BossAgent(m.registry, taskRouter, complianceValidator, escalationHandler, auditLogger, taskStateStore);

  const summary = await bossAgent.run([{ id: randomUUID(), description, priority }]);
  const outcome = summary.outcomes[0];
  if (!outcome) {
    throw new Error("Boss Agent produced no routing outcome.");
  }
  return { decision: outcome.decision as RoutingDecision, escalations };
}

export async function listAvailableAgents(): Promise<readonly string[]> {
  const m = await getModules();
  return m.registry.list().map((spec: { id: string }) => spec.id);
}
