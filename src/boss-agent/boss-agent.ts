// Public facade for the Boss Agent orchestration and routing framework.
// Wires the registry, router, and governance modules together to fulfil the
// in-scope responsibilities from Agents/BossAgent.md:
//   - "Plan the SEO workflow" / "Prioritize tasks" -> priority ordering below.
//   - "Assign tasks to specialist agents"          -> TaskRouter.
//   - "Resolve conflicts between recommendations"  -> tie handling in TaskRouter.
//   - "Escalate uncertainty instead of guessing"    -> EscalationHandler.
// Reviewing/approving specialist agent *output* and coordinating live
// inter-agent *communication* are out of scope for this milestone, since no
// specialist agent is executed here — only a routing decision is produced.

import { randomUUID } from "node:crypto";
import { CliApprovalChannel } from "../core/governance/cli-approval-channel.js";
import { AuditLogger } from "../core/governance/audit-logger.js";
import type { ApprovalChannel } from "../core/governance/approval-channel.js";
import { AgentRegistry, type AgentDirectory } from "./registry/agent-registry.js";
import { KeywordMatchRoutingStrategy } from "./routing/keyword-match-routing-strategy.js";
import { TaskRouter } from "./routing/task-router.js";
import { ComplianceValidator } from "./governance/compliance-validator.js";
import { EscalationHandler } from "./governance/escalation-handler.js";
import { TaskStateStore, type TaskOutcome, type TaskRunRecord } from "./state/task-state-store.js";
import type { BossAgentConfig } from "./config/boss-agent.config.js";
import type { TaskInput } from "./types/task.types.js";

export interface RunSummary {
  readonly runId: string;
  readonly outcomes: readonly TaskOutcome[];
}

const PRIORITY_RANK: Record<TaskInput["priority"], number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export class BossAgent {
  constructor(
    private readonly registry: AgentDirectory,
    private readonly router: TaskRouter,
    private readonly complianceValidator: ComplianceValidator,
    private readonly escalationHandler: EscalationHandler,
    private readonly auditLogger: AuditLogger,
    private readonly taskStateStore: TaskStateStore,
  ) {}

  /**
   * Wires the production implementation: loads the real agent registry from
   * disk and uses the interactive CLI approval channel. Tests should
   * construct a BossAgent directly with fakes/stubs instead of calling this.
   */
  static async create(config: BossAgentConfig): Promise<BossAgent> {
    const registry = await AgentRegistry.load(config.agentsDirectory);
    const strategy = new KeywordMatchRoutingStrategy();
    const router = new TaskRouter(registry, strategy, {
      autoAssignThreshold: config.autoAssignThreshold,
      tieMargin: config.tieMargin,
      maxCandidates: config.maxCandidates,
    });
    const auditLogger = new AuditLogger(config.auditLogPath);
    const approvalChannel: ApprovalChannel = new CliApprovalChannel();
    const escalationHandler = new EscalationHandler(approvalChannel, auditLogger);
    const complianceValidator = new ComplianceValidator();
    const taskStateStore = new TaskStateStore(config.stateDirectory);

    return new BossAgent(registry, router, complianceValidator, escalationHandler, auditLogger, taskStateStore);
  }

  /** The specialist agents currently available for routing. */
  availableAgentIds(): readonly string[] {
    return this.registry.list().map((spec) => spec.id);
  }

  /**
   * Routes every task to a specialist agent (or to escalation/rejection),
   * highest priority first, and persists the run. Never executes a task.
   */
  async run(tasks: readonly TaskInput[]): Promise<RunSummary> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const orderedTasks = [...tasks].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    );

    const outcomes: TaskOutcome[] = [];
    for (const task of orderedTasks) {
      await this.auditLogger.logEvent({
        actor: "boss-agent",
        eventType: "task_received",
        details: { taskId: task.id, description: task.description, priority: task.priority },
      });

      const initialDecision = this.router.route(task);
      this.complianceValidator.assertValid(initialDecision, this.registry);

      const finalDecision = await this.escalationHandler.resolve(task, initialDecision);
      this.complianceValidator.assertValid(finalDecision, this.registry);

      await this.auditLogger.logEvent({
        actor: "boss-agent",
        eventType: "routing_decided",
        details: {
          taskId: task.id,
          status: finalDecision.status,
          assignedAgentId: finalDecision.assignedAgentId,
          rationale: finalDecision.rationale,
        },
      });

      outcomes.push({ task, decision: finalDecision });
    }

    const run: TaskRunRecord = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      outcomes,
    };
    await this.taskStateStore.saveRun(run);

    return { runId, outcomes };
  }
}
